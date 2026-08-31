'use strict'

const assert = require('node:assert/strict')
const { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync, writeSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, relative } = require('node:path')
const test = require('node:test')

const { publishApply, publishRecoveryFile, temporaryPaths } = require('../../skills/init-backlog/lib/publication')
const { actionAfter, effectiveActionFileMode } = require('../../skills/init-backlog/lib/actions')
const { buildApprovedApplyRequest } = require('../../skills/init-backlog/lib/apply-request')
const { runPrivateDispatcher } = require('../../skills/init-backlog/init-backlog')
const { admitApplyManifest } = require('../../skills/init-backlog/lib/apply-manifest')
const { InitBacklogError, failureRecord } = require('../../skills/init-backlog/lib/errors')
const { collectInspection, composeElectionMarker } = require('../../skills/init-backlog/lib/inspection')
const { MAX_RECOVERY_REQUEST_BYTES, canonicalActionOrder, canonicalJson, deriveSemanticActionId, deriveSnapshotId, sha256, validateResultRecord } = require('../../skills/init-backlog/lib/protocol')
const { createInitialLock, resolveTrustedExecutable, stableOpenFile } = require('../../skills/init-backlog/lib/filesystem')
const { analyzeCatalog } = require('../../skills/ready/ready')
const { applyRecovery, inspectRecovery } = require('../../skills/init-backlog/lib/recovery')
const { approvedProgress } = require('../../skills/init-backlog/lib/resume')
const { unwrapText } = require('../../skills/init-backlog/unwrap')
const { ELECTION_MARKER_PATH } = require('./election-oracles')
const { git } = require('./helpers')

// Independent oracle pin: the recovery gate basename is spelled out here on purpose
// and is deliberately not imported from the production constant it verifies.
const RECOVERY_GATE = '.nightshift-init-backlog.recovery-gate'

function fixtureRoot() {
  return mkdtempSync(join(tmpdir(), 'nightshift-init-backlog-publication-'))
}

function hostContext() {
  return {
    claudeContextSource: 'host-observed',
    claudeRootExclusionStatus: 'included',
    codexContextSource: null,
    codexInvocationDirectory: null,
    codexProjectDocMaxBytes: null,
    codexProjectInstructions: [],
  }
}

function inspection(root, overrides = {}) {
  const value = {
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
    hostContext: hostContext(),
    ok: true,
    operation: 'inspect',
    problems: [],
    proposals: [],
    protocolVersion: 1,
    ready: { blocked: [], external: [], found: [], indexes: { found: [], missing: [] }, ready: [] },
    retainedBackups: [],
    root,
    snapshotId: null,
    targets: [],
    templates: [],
    unwrapReady: { after: { blocked: [], external: [], found: [], indexes: { found: [], missing: [] }, ready: [] }, targets: [] },
    warnings: [],
    wrapFindings: [],
    ...overrides,
  }
  value.snapshotId = deriveSnapshotId({ ...value, snapshotId: null })

  return value
}

function request(root, overrides = {}) {
  const carriedInspection = overrides.inspection ?? inspection(root)

  return {
    actions: [],
    host: 'claude-code',
    hostContext: carriedInspection.hostContext,
    inspection: carriedInspection,
    operation: 'apply',
    proposalDispositions: [],
    protocolVersion: 1,
    root,
    semanticDecisions: [],
    versionControlChoice: 'not-required',
    ...overrides,
  }
}

function approvedScaffoldRequest(root, context, carried, versionControlChoice, requireRootIgnore = true) {
  const selected = (proposal) => proposal.condition === 'always' || proposal.condition === 'newline-lf'
  const semanticDecisions = carried.targets
    .filter((target) => target.contentRole === 'semantic' && target.templateId !== null && !target.states.includes('exact-template'))
    .map((target) => ({ conceptIds: carried.templates.find((template) => template.target === target.target && template.templateId === target.templateId).conceptIds, status: 'satisfied', target: target.target }))
  const manifestProposal = {
    actions: canonicalActionOrder(carried.proposals.filter(selected).map((proposal) => proposal.action)),
    proposalDispositions: carried.proposals.map((proposal) => ({ disposition: selected(proposal) ? 'selected' : 'condition-not-selected', proposalId: proposal.proposalId })),
    semanticDecisions,
    versionControlChoice,
    versionControlOptions: ['track', 'ignore', 'deferred', 'not-required'],
  }
  const applyRequest = JSON.parse(buildApprovedApplyRequest({ host: 'codex', hostContext: context, inspection: carried, manifestProposal, root }))
  if (requireRootIgnore) assert.ok(applyRequest.actions.some((action) => action.target === '.gitignore'), 'the approved transition must carry the root ignore action whose resume allowance is under test')

  return applyRequest
}

function realGitScaffoldFixture(root) {
  git(root, ['init', '--quiet'])
  mkdirSync(join(root, '.claude'), { recursive: true })
  const context = { claudeContextSource: null, claudeRootExclusionStatus: null, codexContextSource: 'user-confirmed', codexInvocationDirectory: '.', codexProjectDocMaxBytes: 1048576, codexProjectInstructions: [] }
  const trustedGitPath = resolveTrustedExecutable({ root })
  const collect = (inspectionRoot = root, host = 'codex', hostContext = context, options = {}) => collectInspection(inspectionRoot, host, hostContext, { ...options, trustedGitPath })
  const carried = collect()

  return { applyRequest: approvedScaffoldRequest(root, context, carried, 'track'), carried, collect, context }
}

function realNonGitScaffoldFixture(root) {
  mkdirSync(join(root, '.claude'), { recursive: true })
  const context = { claudeContextSource: null, claudeRootExclusionStatus: null, codexContextSource: 'user-confirmed', codexInvocationDirectory: '.', codexProjectDocMaxBytes: 1048576, codexProjectInstructions: [] }
  const collect = (inspectionRoot = root, host = 'codex', hostContext = context, options = {}) => collectInspection(inspectionRoot, host, hostContext, { ...options, candidates: [], platformEol: 'lf' })
  const carried = collect()

  return { applyRequest: approvedScaffoldRequest(root, context, carried, 'not-required', false), carried, collect }
}

function resumableCreateFixture(root, target = 'FEATURES.md') {
  const bytes = Buffer.from('approved\n', 'utf8')
  const mode = process.platform === 'win32' ? null : 420
  const action = { id: target === 'AGENTS.md' ? 'p-resume-guidance' : 'p-resume-diagnostics', kind: 'create-from-template', mode, newline: 'lf', target, templateId: 'backlog.features' }
  const targetBefore = { bom: null, cleanTextSha256: null, contentBase64: null, contentRole: 'semantic', editableRegions: [], finalNewline: null, kind: 'file', mode, newline: null, rawSha256: null, states: ['missing'], target, templateId: action.templateId, templateSha256: 'a'.repeat(64) }
  const carried = inspection(root, {
    proposals: [{ action, afterBase64: bytes.toString('base64'), beforeBase64: null, condition: 'always', proposalId: action.id, reason: 'missing-target' }],
    targets: [targetBefore],
    templates: [{ conceptIds: [], logicalSha256: 'a'.repeat(64), target, templateId: action.templateId }],
  })
  carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
  const applyRequest = request(root, { actions: [action], inspection: carried, proposalDispositions: [{ disposition: 'selected', proposalId: action.id }], semanticDecisions: [{ conceptIds: [], status: 'satisfied', target }] })
  writeFileSync(join(root, target), bytes)
  const live = inspection(root, { proposals: carried.proposals, ready: carried.ready, targets: [{ ...targetBefore, contentBase64: bytes.toString('base64'), rawSha256: sha256(bytes), states: ['present'] }], templates: carried.templates })

  return { applyRequest, carried, live }
}

function expectCode(callback, code) {
  assert.throws(callback, (error) => error?.record?.code === code || error?.code === code)
}

function unwrapBackupFailureFixture() {
  const root = fixtureRoot()
  const target = '.claude/FEATURES.md'
  const wrapped = Buffer.from('## Area\n### [Alpha](features/alpha.md)\n\n**Requires:** none.\nwrapped\n', 'utf8')
  const unwrapped = Buffer.from('## Area\n### [Alpha](features/alpha.md)\n\n**Requires:** none.\n', 'utf8')
  const mode = process.platform === 'win32' ? null : 0o644
  const action = { afterRawSha256: sha256(unwrapped), beforeRawSha256: sha256(wrapped), id: 'backup-publication-failure', kind: 'unwrap-file', mode, target }
  const carried = inspection(root, {
    ready: analyzeCatalog([{ contents: wrapped.toString('utf8'), target: 'FEATURES.md' }]),
    targets: [{ bom: null, cleanTextSha256: null, contentBase64: wrapped.toString('base64'), contentRole: 'semantic', editableRegions: [{ endByte: wrapped.length, regionId: 'features.document-preamble', startByte: 0 }], finalNewline: true, kind: 'file', mode, newline: 'lf', rawSha256: sha256(wrapped), states: ['wrapped'], target, templateId: 'backlog.features', templateSha256: 'c'.repeat(64) }],
    templates: [{ conceptIds: ['features.dependency-grammar'], logicalSha256: 'c'.repeat(64), target, templateId: 'backlog.features' }],
    proposals: [{ action, afterBase64: unwrapped.toString('base64'), beforeBase64: wrapped.toString('base64'), condition: 'always', proposalId: action.id, reason: 'hard-wrap' }],
    unwrapReady: { after: analyzeCatalog([{ contents: unwrapped.toString('utf8'), target: 'FEATURES.md' }]), targets: [target] },
    wrapFindings: [{ beforeRawSha256: sha256(wrapped), predictedContentBase64: unwrapped.toString('base64'), predictedEditableRegions: [{ endByte: unwrapped.length, regionId: 'features.document-preamble', startByte: 0 }], predictedRawSha256: sha256(unwrapped), target }],
  })
  carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
  const applyRequest = request(root, { actions: [action], inspection: carried, proposalDispositions: [{ disposition: 'selected', proposalId: action.id }], semanticDecisions: [{ conceptIds: ['features.dependency-grammar'], status: 'satisfied', target }] })
  mkdirSync(join(root, '.claude'), { mode: 0o755 })
  writeFileSync(join(root, target), wrapped, { mode: 0o644 })
  const manifestId = admitApplyManifest(applyRequest).manifestId
  const backupTarget = `.tmp/nightshift-init-backlog-unwrap-${carried.snapshotId}-${manifestId}-${sha256(Buffer.from(target, 'utf8'))}.bak`

  return { applyRequest, backupTarget, root, target, unwrapped, wrapped }
}

function hiddenUnwrapFixture() {
  const fixture = unwrapBackupFailureFixture()
  const inspection = fixture.applyRequest.inspection
  fixture.wrapped = Buffer.from('# Issue\n\nThis paragraph is deliberately hard wrapped across\ntwo physical lines so the detector fires.\n', 'utf8')
  fixture.unwrapped = Buffer.from('# Issue\n\nThis paragraph is deliberately hard wrapped across two physical lines so the detector fires.\n', 'utf8')
  const action = { ...fixture.applyRequest.actions[0], afterRawSha256: sha256(fixture.unwrapped), beforeRawSha256: sha256(fixture.wrapped) }
  inspection.ready = analyzeCatalog([{ contents: fixture.wrapped.toString('utf8'), target: 'FEATURES.md' }])
  inspection.targets = inspection.targets.map((record) => ({ ...record, contentBase64: null, contentRole: 'mechanical', editableRegions: [], rawSha256: action.beforeRawSha256, templateId: null, templateSha256: null }))
  inspection.templates = []
  inspection.proposals = inspection.proposals.map((proposal) => ({ ...proposal, action, afterBase64: null, beforeBase64: fixture.wrapped.toString('base64') }))
  inspection.unwrapReady = { after: analyzeCatalog([{ contents: fixture.unwrapped.toString('utf8'), target: 'FEATURES.md' }]), targets: [fixture.target] }
  inspection.wrapFindings = inspection.wrapFindings.map((finding) => ({ ...finding, beforeRawSha256: action.beforeRawSha256, predictedContentBase64: null, predictedEditableRegions: [], predictedRawSha256: action.afterRawSha256 }))
  inspection.snapshotId = deriveSnapshotId({ ...inspection, snapshotId: null })
  fixture.applyRequest = request(fixture.root, { actions: [action], inspection, proposalDispositions: fixture.applyRequest.proposalDispositions })
  writeFileSync(join(fixture.root, fixture.target), fixture.wrapped, { mode: 0o644 })

  return fixture
}

function assertOwnerStageMutationRejected({ transition, mutate, mutateAfterWrite, expectedBytes, expectedMode, expectedLinks = 1 }) {
  const root = fixtureRoot()
  const ownerNonce = '2'.repeat(32)
  try {
    const carried = inspection(root)
    const applyRequest = request(root, { inspection: carried })
    const paths = temporaryPaths(root, admitApplyManifest(applyRequest).manifestId, 1, ownerNonce, carried.snapshotId)
    let afterCreate = false
    let publicationLinks = 0
    const options = {
      currentInspection: carried,
      linkSync: (...args) => {
        publicationLinks += 1

        return linkSync(...args)
      },
      onTransition: (point) => {
        if (point !== transition) return
        afterCreate = point === 'after-owner-stage-create'
        mutate(paths)
      },
      ownerNonce,
    }
    if (mutateAfterWrite) {
      options.writeSync = (...args) => {
        const count = writeSync(...args)
        if (afterCreate) {
          mutateAfterWrite(paths)
          afterCreate = false
        }

        return count
      }
    }

    expectCode(() => publishApply(applyRequest, options), 'runtime-lock')
    assert.equal(publicationLinks, 0)
    assert.equal(existsSync(paths.lock), false)
    assert.equal(existsSync(paths.lockStage), true)
    const stageBytes = readFileSync(paths.lockStage)
    if (expectedBytes) {
      assert.deepEqual(stageBytes, expectedBytes)
    } else {
      const stageRecord = JSON.parse(stageBytes.toString('utf8'))
      assert.deepEqual(stageBytes, Buffer.from(`${canonicalJson(stageRecord)}\n`, 'utf8'))
    }
    if (expectedMode !== null) assert.equal(statSync(paths.lockStage).mode & 0o777, expectedMode)
    assert.equal(statSync(paths.lockStage).nlink, expectedLinks)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
}

function runPublicationCases() {
  test('actionAfter accepts valid visible and hidden unwrap predictions', () => {
    for (const fixture of [unwrapBackupFailureFixture(), hiddenUnwrapFixture()]) {
      try {
        assert.deepEqual(actionAfter(fixture.applyRequest, fixture.applyRequest.actions[0], fixture.root, {}), fixture.unwrapped)
      } finally {
        rmSync(fixture.root, { force: true, recursive: true })
      }
    }
  })

  test('actionAfter rejects visible and hidden output that misses its predicted digest', () => {
    const visibleFixture = unwrapBackupFailureFixture()
    try {
      visibleFixture.applyRequest.inspection.wrapFindings[0].predictedContentBase64 = Buffer.from('different visible output\n', 'utf8').toString('base64')

      expectCode(() => actionAfter(visibleFixture.applyRequest, visibleFixture.applyRequest.actions[0], visibleFixture.root, {}), 'manifest-invalid')
    } finally {
      rmSync(visibleFixture.root, { force: true, recursive: true })
    }
    const fixture = hiddenUnwrapFixture()
    try {
      const action = fixture.applyRequest.actions[0]
      action.afterRawSha256 = 'a'.repeat(64)
      fixture.applyRequest.inspection.wrapFindings[0].predictedRawSha256 = action.afterRawSha256

      expectCode(() => actionAfter(fixture.applyRequest, action, fixture.root, {}), 'manifest-invalid')
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('unwrap prediction drift writes no project target on normal or resume admission', () => {
    for (const resume of [false, true]) {
      const fixture = unwrapBackupFailureFixture()
      try {
        fixture.applyRequest.inspection.wrapFindings[0].beforeRawSha256 = 'a'.repeat(64)
        fixture.applyRequest.inspection.snapshotId = deriveSnapshotId({ ...fixture.applyRequest.inspection, snapshotId: null })
        const targetPath = join(fixture.root, fixture.target)
        const targetWrites = []

        expectCode(() => publishApply(fixture.applyRequest, { currentInspection: fixture.applyRequest.inspection, resume, writeSpy: (path) => { if (path === targetPath) targetWrites.push(path) } }), 'manifest-invalid')
        assert.deepEqual(targetWrites, [], String(resume))
        assert.deepEqual(readFileSync(targetPath), fixture.wrapped, String(resume))
      } finally {
        rmSync(fixture.root, { force: true, recursive: true })
      }
    }
  })

  test('publication-time hidden unwrap prediction failure writes no project target', () => {
    const fixture = hiddenUnwrapFixture()
    const targetPath = join(fixture.root, fixture.target)
    const targetWrites = []
    try {
      expectCode(() => publishApply(fixture.applyRequest, {
        currentInspection: fixture.applyRequest.inspection,
        onTransition: (point) => {
          if (point !== 'after-lock-upgrade') return
          const action = fixture.applyRequest.actions[0]
          action.afterRawSha256 = 'a'.repeat(64)
          fixture.applyRequest.inspection.wrapFindings[0].predictedRawSha256 = action.afterRawSha256
        },
        writeSpy: (path) => { if (path === targetPath) targetWrites.push(path) },
      }), 'manifest-invalid')
      assert.deepEqual(targetWrites, [])
      assert.deepEqual(readFileSync(targetPath), fixture.wrapped)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('persistent linked staging parents create no external publication artifact', () => {
    const root = fixtureRoot()
    const external = fixtureRoot()
    const parent = join(root, 'nested')
    try {
      symlinkSync(external, parent, process.platform === 'win32' ? 'junction' : 'dir')
      const target = join(parent, 'FEATURES.md')
      const temporary = join(parent, '.publication.tmp')

      assert.throws(() => publishRecoveryFile(root, target, Buffer.from('content\n', 'utf8'), process.platform === 'win32' ? null : 0o600, { recoveryId: 'a'.repeat(64), temporary }))
      assert.deepEqual(readdirSync(external), [])
    } finally {
      rmSync(root, { force: true, recursive: true })
      rmSync(external, { force: true, recursive: true })
    }
  })

  test('exact edits preserve the inspected file mode across publication checks', () => {
    assert.equal(effectiveActionFileMode({ kind: 'exact-edit' }, 0o600, { platform: 'linux' }), 0o600)
    assert.equal(effectiveActionFileMode({ kind: 'create-from-template', mode: 0o640 }, null, { platform: 'linux' }), 0o640)
    assert.equal(effectiveActionFileMode({ kind: 'exact-edit' }, 0o600, { platform: 'win32' }), null)
  })

  test('production mechanical inspection bytes publish through the approved request', () => {
    const root = fixtureRoot()
    const wrapped = '# Issue\n\nThis paragraph is deliberately hard wrapped across\ntwo physical lines so the detector fires.\n'
    const unwrapped = '# Issue\n\nThis paragraph is deliberately hard wrapped across two physical lines so the detector fires.\n'
    try {
      const context = { claudeContextSource: null, claudeRootExclusionStatus: null, codexContextSource: 'user-confirmed', codexInvocationDirectory: '.', codexProjectDocMaxBytes: 1048576, codexProjectInstructions: [] }
      const approvedRequest = (carried) => {
        const selected = (proposal) => proposal.condition === 'always' || proposal.condition === 'newline-lf'
        const semanticDecisions = carried.targets
          .filter((target) => target.contentRole === 'semantic' && target.templateId !== null && !target.states.includes('exact-template'))
          .map((target) => ({ conceptIds: carried.templates.find((template) => template.target === target.target && template.templateId === target.templateId).conceptIds, status: 'satisfied', target: target.target }))
        const manifestProposal = {
          actions: canonicalActionOrder(carried.proposals.filter(selected).map((proposal) => proposal.action)),
          proposalDispositions: carried.proposals.map((proposal) => ({ disposition: selected(proposal) ? 'selected' : 'condition-not-selected', proposalId: proposal.proposalId })),
          semanticDecisions,
          versionControlChoice: 'not-required',
          versionControlOptions: ['track', 'ignore', 'deferred', 'not-required'],
        }

        return JSON.parse(buildApprovedApplyRequest({ host: 'codex', hostContext: context, inspection: carried, manifestProposal, root }))
      }
      const scaffoldInspection = collectInspection(root, 'codex', context, { candidates: [] })
      publishApply(approvedRequest(scaffoldInspection), { currentInspection: scaffoldInspection })
      mkdirSync(join(root, '.claude', 'bugs'), { recursive: true })
      writeFileSync(join(root, '.claude', 'bugs', 'issue.md'), wrapped)
      const carried = collectInspection(root, 'codex', context, { candidates: [] })
      const applyRequest = approvedRequest(carried)

      const result = publishApply(applyRequest, { currentInspection: carried })

      assert.equal(result.ok, true)
      assert.equal(result.outcomes.find((outcome) => outcome.target === '.claude/bugs/issue.md').status, 'unwrapped')
      assert.equal(readFileSync(join(root, '.claude', 'bugs', 'issue.md'), 'utf8'), unwrapped)

      writeFileSync(join(root, '.claude', 'bugs', 'issue.md'), wrapped)
      const driftInspection = collectInspection(root, 'codex', context, { candidates: [] })
      const driftRequest = approvedRequest(driftInspection)
      const replacement = '# Issue\n\nConcurrent replacement.\n'
      writeFileSync(join(root, '.claude', 'bugs', 'issue.md'), replacement)
      assert.throws(() => publishApply(driftRequest, { currentInspection: driftInspection }), (error) => error.record?.code === 'filesystem' && /Mechanical unwrap input changed/.test(error.cause?.message ?? ''))
      assert.equal(readFileSync(join(root, '.claude', 'bugs', 'issue.md'), 'utf8'), replacement)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('ordinary apply rejects every present recovery gate before changing project targets', () => {
    for (const shape of ['empty', 'malformed', 'owned']) {
      const fixture = unwrapBackupFailureFixture()
      const gate = join(fixture.root, RECOVERY_GATE)
      try {
        mkdirSync(gate, { mode: 0o700 })
        if (shape === 'malformed') writeFileSync(join(gate, 'owner.new'), Buffer.from('malformed\n', 'utf8'), { mode: 0o600 })
        if (shape === 'owned') {
          const owner = { createdAtUnixMs: 0, manifestId: null, operation: 'recover-apply', ownerNonce: 'a'.repeat(32), pid: 321, protocolVersion: 1, recoveryId: 'b'.repeat(64), root: fixture.root, temporaryPaths: [], unfinalizedDirectories: [] }
          writeFileSync(join(gate, 'owner.json'), Buffer.from(`${canonicalJson(owner)}\n`, 'utf8'), { mode: 0o600 })
        }
        const before = readFileSync(join(fixture.root, fixture.target))
        const dispatchRequest = request(fixture.root)
        const applyBytes = Buffer.from(`${canonicalJson(dispatchRequest)}\n`, 'utf8')
        const expected = (error) => error.record?.code === 'runtime-lock' && error.record.phase === 'lock' && error.record.target === RECOVERY_GATE

        assert.throws(() => publishApply(fixture.applyRequest, { currentInspection: fixture.applyRequest.inspection, collectInspection: () => fixture.applyRequest.inspection }), expected, shape)
        const dispatched = runPrivateDispatcher(applyBytes, { apply: (value) => publishApply(value, { currentInspection: dispatchRequest.inspection }) })
        assert.equal(dispatched.exitCode, 1, shape)
        const record = JSON.parse(dispatched.stdout.toString('utf8'))
        assert.equal(record.code, 'runtime-lock', shape)
        assert.equal(record.phase, 'lock', shape)
        assert.equal(record.target, RECOVERY_GATE, shape)
        assert.deepEqual(readFileSync(join(fixture.root, fixture.target)), before, shape)
      } finally {
        rmSync(fixture.root, { force: true, recursive: true })
      }
    }
  })

  test('ordinary apply rejects a recovery gate created at each admission boundary', () => {
    for (const boundary of ['after-owner-publish', 'after-inspection']) {
      const fixture = unwrapBackupFailureFixture()
      const gate = join(fixture.root, RECOVERY_GATE)
      try {
        const before = readFileSync(join(fixture.root, fixture.target))
        const options = boundary === 'after-owner-publish'
          ? { onPublished: (destination) => { if (destination.endsWith('.nightshift-init-backlog.lock')) mkdirSync(gate, { mode: 0o700 }) } }
          : { collectInspection: () => { mkdirSync(gate, { mode: 0o700 }); return fixture.applyRequest.inspection } }
        assert.throws(() => publishApply(fixture.applyRequest, options), (error) => error.record?.code === 'runtime-lock' && error.record.phase === 'lock' && error.record.target === RECOVERY_GATE, boundary)
        assert.deepEqual(readFileSync(join(fixture.root, fixture.target)), before, boundary)
        assert.equal(existsSync(join(fixture.root, '.nightshift-init-backlog.lock')), false, boundary)
      } finally {
        rmSync(fixture.root, { force: true, recursive: true })
      }
    }
  })

  test('ordinary apply rejects a recovery gate created before the first project effect', () => {
    const fixture = unwrapBackupFailureFixture()
    const gate = join(fixture.root, RECOVERY_GATE)
    try {
      const before = readFileSync(join(fixture.root, fixture.target))
      assert.throws(() => publishApply(fixture.applyRequest, { currentInspection: fixture.applyRequest.inspection, collectInspection: () => fixture.applyRequest.inspection, onTransition: (point) => { if (point === 'after-lock-upgrade') mkdirSync(gate, { mode: 0o700 }) } }), (error) => error.record?.code === 'runtime-lock' && error.record.phase === 'lock' && error.record.target === RECOVERY_GATE)
      assert.deepEqual(readFileSync(join(fixture.root, fixture.target)), before)
      assert.equal(existsSync(join(fixture.root, '.nightshift-init-backlog.lock')), false)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('publishes an empty approved apply and returns a closed success record', () => {
    const root = fixtureRoot()
    try {
      const result = publishApply(request(root), { collectInspection: () => inspection(root) })

      assert.equal(result.ok, true)
      assert.equal(result.operation, 'apply')
      assert.equal(result.complete, true)
      assert.deepEqual(result.outcomes, [])
      assert.deepEqual(validateResultRecord(result), result)
      assert.equal(readdirSync(root).length, 0)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('handled backup publication failures retain the linked backup in typed recovery evidence', () => {
    const fixture = unwrapBackupFailureFixture()
    try {
      assert.throws(() => publishApply(fixture.applyRequest, { currentInspection: fixture.applyRequest.inspection, collectInspection: () => fixture.applyRequest.inspection, onPublished: (destination) => { if (destination.endsWith('.bak')) throw new Error('backup callback failure') } }), (error) => {
        assert.equal(error.record?.code, 'cleanup-failed')
        assert.deepEqual(error.record?.recovery, { retainedBackups: [fixture.backupTarget], status: 'cleanup-failed', warnings: [{ code: 'manual-cleanup', detail: 'Publication lock requires manual cleanup.', target: '.nightshift-init-backlog.lock' }] })
        return true
      })
      assert.equal(existsSync(join(fixture.root, ...fixture.backupTarget.split('/'))), true)
      assert.equal(statSync(join(fixture.root, ...fixture.backupTarget.split('/'))).nlink, 2)
      assert.deepEqual(readFileSync(join(fixture.root, ...fixture.backupTarget.split('/'))), fixture.wrapped)
      assert.deepEqual(readFileSync(join(fixture.root, fixture.target)), fixture.wrapped)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('generic handled failure after backup publication reports the retained backup on disk', () => {
    const fixture = unwrapBackupFailureFixture()
    try {
      assert.throws(() => publishApply(fixture.applyRequest, { currentInspection: fixture.applyRequest.inspection, collectInspection: () => fixture.applyRequest.inspection, onRenamed: (destination) => { if (destination.endsWith('FEATURES.md')) throw new Error('target callback failure after backup publication') } }), (error) => {
        assert.equal(error.record?.code, 'filesystem')
        assert.equal(error.record?.phase, 'publish')
        assert.deepEqual(error.record?.recovery, { retainedBackups: [fixture.backupTarget], status: 'none', warnings: [{ code: 'manual-cleanup', detail: 'Unwrap backups remain retained after publication failure.', target: null }] })
        return true
      })
      assert.equal(existsSync(join(fixture.root, ...fixture.backupTarget.split('/'))), true)
      assert.equal(statSync(join(fixture.root, ...fixture.backupTarget.split('/'))).nlink, 1)
      assert.deepEqual(readFileSync(join(fixture.root, ...fixture.backupTarget.split('/'))), fixture.wrapped)
      assert.deepEqual(readFileSync(join(fixture.root, fixture.target)), fixture.unwrapped)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('successful unwrap discloses creation of the retained empty backup directory exactly once', () => {
    const createFixture = (withTmp) => {
      const root = fixtureRoot()
      const target = '.claude/FEATURES.md'
      const wrapped = Buffer.from('## Area\n### [Alpha](features/alpha.md)\n\n**Requires:** none.\nwrapped\n', 'utf8')
      const unwrapped = Buffer.from('## Area\n### [Alpha](features/alpha.md)\n\n**Requires:** none.\n', 'utf8')
      const mode = process.platform === 'win32' ? null : 0o644
      const action = { afterRawSha256: sha256(unwrapped), beforeRawSha256: sha256(wrapped), id: 'backup-directory-warning', kind: 'unwrap-file', mode, target }
      const carried = inspection(root, {
        ready: analyzeCatalog([{ contents: wrapped.toString('utf8'), target: 'FEATURES.md' }]),
        targets: [{ bom: null, cleanTextSha256: null, contentBase64: wrapped.toString('base64'), contentRole: 'semantic', editableRegions: [{ endByte: wrapped.length, regionId: 'features.document-preamble', startByte: 0 }], finalNewline: true, kind: 'file', mode, newline: 'lf', rawSha256: sha256(wrapped), states: ['wrapped'], target, templateId: 'backlog.features', templateSha256: 'c'.repeat(64) }],
        templates: [{ conceptIds: ['features.dependency-grammar'], logicalSha256: 'c'.repeat(64), target, templateId: 'backlog.features' }],
        proposals: [{ action, afterBase64: unwrapped.toString('base64'), beforeBase64: wrapped.toString('base64'), condition: 'always', proposalId: action.id, reason: 'hard-wrap' }],
        unwrapReady: { after: analyzeCatalog([{ contents: unwrapped.toString('utf8'), target: 'FEATURES.md' }]), targets: [target] },
        wrapFindings: [{ beforeRawSha256: sha256(wrapped), predictedContentBase64: unwrapped.toString('base64'), predictedEditableRegions: [{ endByte: unwrapped.length, regionId: 'features.document-preamble', startByte: 0 }], predictedRawSha256: sha256(unwrapped), target }],
      })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const post = inspection(root, { ready: carried.unwrapReady.after, targets: [{ ...carried.targets[0], contentBase64: unwrapped.toString('base64'), rawSha256: sha256(unwrapped), states: ['present'] }], unwrapReady: { after: carried.unwrapReady.after, targets: [] }, wrapFindings: [] })
      const applyRequest = request(root, { actions: [action], inspection: carried, proposalDispositions: [{ disposition: 'selected', proposalId: action.id }], semanticDecisions: [{ conceptIds: ['features.dependency-grammar'], status: 'satisfied', target }] })
      mkdirSync(join(root, '.claude'), { mode: 0o755 })
      writeFileSync(join(root, target), wrapped, { mode: 0o644 })
      if (withTmp) mkdirSync(join(root, '.tmp'), { mode: 0o700 })

      return { applyRequest, post, root }
    }
    const fresh = createFixture(false)
    const existing = createFixture(true)
    try {
      const freshResult = publishApply(fresh.applyRequest, { currentInspection: fresh.applyRequest.inspection, collectInspection: () => fresh.post })
      const existingResult = publishApply(existing.applyRequest, { currentInspection: existing.applyRequest.inspection, collectInspection: () => existing.post })

      assert.deepEqual(freshResult.warnings.filter((item) => item.code === 'runtime-support-created'), [{ code: 'runtime-support-created', detail: 'Controller created the shared .tmp directory.', target: '.tmp' }])
      assert.equal(existingResult.warnings.some((item) => item.code === 'runtime-support-created'), false)
      assert.equal(existsSync(join(fresh.root, '.tmp')), true)
      assert.deepEqual(readdirSync(join(fresh.root, '.tmp')), [])
    } finally {
      rmSync(fresh.root, { force: true, recursive: true })
      rmSync(existing.root, { force: true, recursive: true })
    }
  })

  test('publishes an unwrap plus semantic repair without a ready catalog injection', () => {
    const root = fixtureRoot()
    const featuresText = '## Area\n### [Alpha](features/alpha.md)\n\n**Requires:** none.\n'
    const finalText = featuresText.replace('## Area', '## Repaired area')
    const wrappedText = '# Alpha\n\n**Requires:** none.\nwrapped\n'
    const unwrappedText = unwrapText(wrappedText)
    const features = Buffer.from(featuresText, 'utf8')
    const final = Buffer.from(finalText, 'utf8')
    const wrapped = Buffer.from(wrappedText, 'utf8')
    const unwrapped = Buffer.from(unwrappedText, 'utf8')
    const semanticTarget = '.claude/FEATURES.md'
    const unwrapTarget = '.claude/features/alpha.md'
    const mode = process.platform === 'win32' ? null : 420
    try {
      mkdirSync(join(root, '.claude/features'), { mode: 0o755, recursive: true })
      writeFileSync(join(root, semanticTarget), features, { mode: 0o644 })
      writeFileSync(join(root, unwrapTarget), wrapped, { mode: 0o644 })
      const unwrap = { afterRawSha256: sha256(unwrapped), beforeRawSha256: sha256(wrapped), id: 'p-public-ready-catalog-unwrap', kind: 'unwrap-file', mode, target: unwrapTarget }
      const semanticWithoutId = { afterBase64: final.toString('base64'), beforeBase64: features.toString('base64'), kind: 'exact-edit', regionId: 'features.document-preamble', target: semanticTarget }
      const semantic = { ...semanticWithoutId, id: deriveSemanticActionId(semanticWithoutId) }
      const carried = inspection(root, {
        ready: analyzeCatalog([{ contents: featuresText, target: 'FEATURES.md' }, { contents: wrappedText, target: 'features/alpha.md' }]),
        targets: [
          { bom: null, cleanTextSha256: null, contentBase64: features.toString('base64'), contentRole: 'semantic', editableRegions: [{ endByte: features.length, regionId: 'features.document-preamble', startByte: 0 }], finalNewline: true, kind: 'file', mode, newline: 'lf', rawSha256: sha256(features), states: ['present'], target: semanticTarget, templateId: 'backlog.features', templateSha256: 'c'.repeat(64) },
          { bom: null, cleanTextSha256: null, contentBase64: wrapped.toString('base64'), contentRole: 'mechanical', editableRegions: [], finalNewline: true, kind: 'file', mode, newline: 'lf', rawSha256: sha256(wrapped), states: ['wrapped'], target: unwrapTarget, templateId: null, templateSha256: null },
        ],
        templates: [{ conceptIds: ['features.dependency-grammar'], logicalSha256: 'c'.repeat(64), target: semanticTarget, templateId: 'backlog.features' }],
        proposals: [{ action: unwrap, afterBase64: null, beforeBase64: wrapped.toString('base64'), condition: 'always', proposalId: unwrap.id, reason: 'hard-wrap' }],
        unwrapReady: { after: analyzeCatalog([{ contents: featuresText, target: 'FEATURES.md' }, { contents: unwrappedText, target: 'features/alpha.md' }]), targets: [unwrapTarget] },
        wrapFindings: [{ beforeRawSha256: sha256(wrapped), predictedContentBase64: null, predictedEditableRegions: [], predictedRawSha256: sha256(unwrapped), target: unwrapTarget }],
      })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const applyRequest = request(root, { actions: [unwrap, semantic], inspection: carried, proposalDispositions: [{ disposition: 'selected', proposalId: unwrap.id }], semanticDecisions: [{ conceptIds: ['features.dependency-grammar'], status: 'satisfied', target: semanticTarget }] })
      const unwrapInspection = inspection(root, { ...carried, ready: carried.unwrapReady.after, targets: [{ ...carried.targets[0] }, { ...carried.targets[1], contentBase64: unwrapped.toString('base64'), rawSha256: sha256(unwrapped), states: ['present'] }] })
      const finalInspection = inspection(root, { ...carried, ready: carried.unwrapReady.after, targets: [{ ...carried.targets[0], contentBase64: final.toString('base64'), rawSha256: sha256(final) }, { ...carried.targets[1], contentBase64: unwrapped.toString('base64'), rawSha256: sha256(unwrapped), states: ['present'] }] })
      const result = publishApply(applyRequest, {
        collectInspection: () => readFileSync(join(root, unwrapTarget)).equals(unwrapped) && readFileSync(join(root, semanticTarget)).equals(features) ? unwrapInspection : finalInspection,
        currentInspection: carried,
        rescanRegions: ({ content }) => [{ endByte: content.length, regionId: 'features.document-preamble', startByte: 0 }],
      })

      assert.deepEqual(result.postInspect.ready, finalInspection.ready)
      assert.deepEqual(readFileSync(join(root, semanticTarget)), final)
      assert.deepEqual(readFileSync(join(root, unwrapTarget)), unwrapped)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('publishes a mechanical unwrap without a ready catalog injection', () => {
    const root = fixtureRoot()
    const featuresText = '## Area\n### [Alpha](features/alpha.md)\n\n**Requires:** none.\n'
    const wrappedText = '# Alpha\n\n**Requires:** none.\nwrapped\n'
    const unwrappedText = unwrapText(wrappedText)
    const features = Buffer.from(featuresText, 'utf8')
    const wrapped = Buffer.from(wrappedText, 'utf8')
    const unwrapped = Buffer.from(unwrappedText, 'utf8')
    const target = '.claude/features/alpha.md'
    const mode = process.platform === 'win32' ? null : 420
    try {
      mkdirSync(join(root, '.claude/features'), { mode: 0o755, recursive: true })
      writeFileSync(join(root, '.claude/FEATURES.md'), features, { mode: 0o644 })
      writeFileSync(join(root, target), wrapped, { mode: 0o644 })
      const unwrap = { afterRawSha256: sha256(unwrapped), beforeRawSha256: sha256(wrapped), id: 'p-public-mechanical-ready-catalog-unwrap', kind: 'unwrap-file', mode, target }
      const carried = inspection(root, {
        ready: analyzeCatalog([{ contents: featuresText, target: 'FEATURES.md' }, { contents: wrappedText, target: 'features/alpha.md' }]),
        targets: [
          { bom: null, cleanTextSha256: null, contentBase64: features.toString('base64'), contentRole: 'semantic', editableRegions: [], finalNewline: true, kind: 'file', mode, newline: 'lf', rawSha256: sha256(features), states: ['present'], target: '.claude/FEATURES.md', templateId: null, templateSha256: null },
          { bom: null, cleanTextSha256: null, contentBase64: wrapped.toString('base64'), contentRole: 'mechanical', editableRegions: [], finalNewline: true, kind: 'file', mode, newline: 'lf', rawSha256: sha256(wrapped), states: ['wrapped'], target, templateId: null, templateSha256: null },
        ],
        proposals: [{ action: unwrap, afterBase64: null, beforeBase64: wrapped.toString('base64'), condition: 'always', proposalId: unwrap.id, reason: 'hard-wrap' }],
        unwrapReady: { after: analyzeCatalog([{ contents: featuresText, target: 'FEATURES.md' }, { contents: unwrappedText, target: 'features/alpha.md' }]), targets: [target] },
        wrapFindings: [{ beforeRawSha256: sha256(wrapped), predictedContentBase64: null, predictedEditableRegions: [], predictedRawSha256: sha256(unwrapped), target }],
      })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const applyRequest = request(root, { actions: [unwrap], inspection: carried, proposalDispositions: [{ disposition: 'selected', proposalId: unwrap.id }] })
      const post = inspection(root, {
        ...carried,
        ready: carried.unwrapReady.after,
        targets: [{ ...carried.targets[0] }, { ...carried.targets[1], contentBase64: unwrapped.toString('base64'), rawSha256: sha256(unwrapped), states: ['present'] }],
        unwrapReady: { after: carried.unwrapReady.after, targets: [] },
        wrapFindings: [],
      })
      const result = publishApply(applyRequest, { collectInspection: () => post, currentInspection: carried })

      assert.deepEqual(result.postInspect.ready, carried.unwrapReady.after)
      assert.deepEqual(readFileSync(join(root, target)), unwrapped)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('retires unwrap backups before a later same-target semantic crash', () => {
    const root = fixtureRoot()
    const wrappedText = '## Area\n### [Alpha](features/alpha.md)\n\n**Requires:** none.\nwrapped\n'
    const unwrappedText = wrappedText.replace('wrapped\n', '')
    const finalText = unwrappedText.replace('none.', 'NONE.')
    const wrapped = Buffer.from(wrappedText, 'utf8')
    const unwrapped = Buffer.from(unwrappedText, 'utf8')
    const final = Buffer.from(finalText, 'utf8')
    const target = '.claude/FEATURES.md'
    const catalogTarget = 'FEATURES.md'
    const mode = process.platform === 'win32' ? null : 420
    const absentPid = () => { const error = new Error('absent'); error.code = 'ESRCH'; throw error }
    try {
      mkdirSync(join(root, '.claude'), { mode: 0o755 })
      writeFileSync(join(root, target), wrapped, { mode: 0o644 })
      const unwrap = { afterRawSha256: sha256(unwrapped), beforeRawSha256: sha256(wrapped), id: 'p-unwrap-before-semantic', kind: 'unwrap-file', mode, target }
      const semanticWithoutId = { afterBase64: final.toString('base64'), beforeBase64: unwrapped.toString('base64'), kind: 'exact-edit', regionId: 'features.document-preamble', target }
      const semantic = { ...semanticWithoutId, id: deriveSemanticActionId(semanticWithoutId) }
      const carried = inspection(root, {
        ready: analyzeCatalog([{ contents: wrappedText, target: catalogTarget }]),
        targets: [{ bom: null, cleanTextSha256: null, contentBase64: wrapped.toString('base64'), contentRole: 'semantic', editableRegions: [{ endByte: wrapped.length, regionId: 'features.document-preamble', startByte: 0 }], finalNewline: true, kind: 'file', mode, newline: 'lf', rawSha256: sha256(wrapped), states: ['present'], target, templateId: 'backlog.features', templateSha256: 'c'.repeat(64) }],
        templates: [{ conceptIds: ['features.dependency-grammar'], logicalSha256: 'c'.repeat(64), target, templateId: 'backlog.features' }],
        proposals: [{ action: unwrap, afterBase64: unwrapped.toString('base64'), beforeBase64: wrapped.toString('base64'), condition: 'always', proposalId: unwrap.id, reason: 'hard-wrap' }],
        unwrapReady: { after: analyzeCatalog([{ contents: unwrappedText, target: catalogTarget }]), targets: [target] },
        wrapFindings: [{ beforeRawSha256: sha256(wrapped), predictedContentBase64: unwrapped.toString('base64'), predictedEditableRegions: [{ endByte: unwrapped.length, regionId: 'features.document-preamble', startByte: 0 }], predictedRawSha256: sha256(unwrapped), target }],
      })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const applyRequest = request(root, { actions: [unwrap, semantic], inspection: carried, proposalDispositions: [{ disposition: 'selected', proposalId: unwrap.id }], semanticDecisions: [{ conceptIds: ['features.dependency-grammar'], status: 'satisfied', target }] })
      const finalInspection = inspection(root, { ...carried, ready: analyzeCatalog([{ contents: finalText, target: catalogTarget }]), targets: [{ ...carried.targets[0], contentBase64: final.toString('base64'), rawSha256: sha256(final) }] })
      const midInspection = inspection(root, { ...carried, ready: carried.unwrapReady.after, targets: [{ ...carried.targets[0], contentBase64: unwrapped.toString('base64'), rawSha256: sha256(unwrapped) }] })
      const manifestId = admitApplyManifest(applyRequest, { readyCatalog: [{ contents: wrappedText, target: catalogTarget }], rescanRegions: ({ content }) => [{ endByte: content.length, regionId: 'features.document-preamble', startByte: 0 }] }).manifestId
      const semanticTemporary = join(root, '.claude', `.nightshift-init-backlog.${manifestId}.2.tmp`)
      const originalRename = renameSync
      assert.throws(() => publishApply(applyRequest, {
        collectInspection: () => readFileSync(join(root, target)).equals(unwrapped) ? midInspection : finalInspection,
        currentInspection: carried,
        crash: true,
        ownerNonce: 'd'.repeat(32),
        readyCatalog: [{ contents: wrappedText, target: catalogTarget }],
        renameSync: (source, destination) => {
          originalRename(source, destination)
          if (source === semanticTemporary) throw new Error('later semantic rename crash')
        },
        rescanRegions: ({ content }) => [{ endByte: content.length, regionId: 'features.document-preamble', startByte: 0 }],
      }), /later semantic rename crash/)
      const backup = readdirSync(join(root, '.tmp')).find((name) => name.endsWith('.bak'))
      assert.equal(backup, undefined)
      const stale = inspectRecovery({ host: 'claude-code', hostContext: hostContext(), operation: 'recover-inspect', protocolVersion: 1, recoveryKind: 'stale-owner', recoveryTarget: '.nightshift-init-backlog.lock', root }, { killProcess: absentPid })
      const recovered = applyRecovery({ disposition: 'cleanup', host: 'claude-code', hostContext: hostContext(), operation: 'recover-apply', protocolVersion: 1, recoveryInspection: stale, root }, { killProcess: absentPid })
      assert.equal(recovered.status, 'completed')
      assert.deepEqual(readFileSync(join(root, target)), final)
      assert.equal(existsSync(semanticTemporary), false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('publishes a directory and new file in action order with final modes', () => {
    const root = fixtureRoot()
    try {
      const directoryMode = process.platform === 'win32' ? null : 493
      const fileMode = process.platform === 'win32' ? null : 420
      const directoryAction = { id: 'p-directory', kind: 'ensure-directory', mode: directoryMode, target: '.claude' }
      const fileBytes = Buffer.from('# Features\n', 'utf8')
      const fileAction = { id: 'p-file', kind: 'create-from-template', mode: fileMode, newline: 'lf', target: '.claude/FEATURES.md', templateId: 'backlog.features' }
      const carried = inspection(root, {
        targets: [
          { bom: null, cleanTextSha256: null, contentBase64: null, contentRole: 'none', editableRegions: [], finalNewline: null, kind: 'directory', mode: directoryMode, newline: null, rawSha256: null, states: ['missing'], target: '.claude', templateId: null, templateSha256: null },
          { bom: null, cleanTextSha256: null, contentBase64: null, contentRole: 'semantic', editableRegions: [], finalNewline: null, kind: 'file', mode: fileMode, newline: null, rawSha256: null, states: ['missing'], target: '.claude/FEATURES.md', templateId: 'backlog.features', templateSha256: 'a'.repeat(64) },
        ],
        proposals: [
          { action: directoryAction, afterBase64: null, beforeBase64: null, condition: 'always', proposalId: directoryAction.id, reason: 'missing-target' },
          { action: fileAction, afterBase64: fileBytes.toString('base64'), beforeBase64: null, condition: 'always', proposalId: fileAction.id, reason: 'missing-target' },
        ],
        templates: [{ conceptIds: [], logicalSha256: 'a'.repeat(64), target: '.claude/FEATURES.md', templateId: 'backlog.features' }],
      })
      carried.ready = analyzeCatalog([{ contents: '# Features\n', target: 'FEATURES.md' }])
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const result = publishApply(request(root, { actions: [directoryAction, fileAction], inspection: carried, proposalDispositions: [{ disposition: 'selected', proposalId: directoryAction.id }, { disposition: 'selected', proposalId: fileAction.id }], semanticDecisions: [{ conceptIds: [], status: 'satisfied', target: '.claude/FEATURES.md' }] }), { collectInspection: () => carried })

      assert.deepEqual(result.outcomes.map((item) => item.status), ['created', 'created'])
      assert.equal(readFileSync(join(root, '.claude/FEATURES.md'), 'utf8'), '# Features\n')
      if (process.platform !== 'win32') {
        assert.equal(statSync(join(root, '.claude')).mode & 0o777, 0o755)
        assert.equal(statSync(join(root, '.claude/FEATURES.md')).mode & 0o777, 0o644)
      }
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('derives every closed temporary name without collisions', () => {
    const root = 'C:/publication-fixture'
    const paths = temporaryPaths(root, 'a'.repeat(64), 2, 'b'.repeat(32), 'c'.repeat(64))

    assert.deepEqual(Object.keys(paths).sort(), ['action', 'election', 'electionAlias', 'electionNewWitness', 'electionOldWitness', 'electionTombstone', 'lock', 'lockNext', 'lockStage'])
    assert.match(paths.lockStage, /\.nightshift-init-backlog\.lock\.\d+\.[a-f0-9]{32}\.new$/)
    assert.match(paths.lockNext, /\.nightshift-init-backlog\.lock\.[a-f0-9]{32}\.next$/)
    assert.match(paths.action, /\.nightshift-init-backlog\.[a-f0-9]{64}\.2\.tmp$/)
    assert.match(paths.election, /\.nightshift-init-backlog-election\.[a-f0-9]{64}\.tmp$/)
    assert.equal(new Set(Object.values(paths)).size, Object.values(paths).length - 1)
  })

  test('derives generation-specific marker witnesses and tombstone paths', () => {
    const root = fixtureRoot()
    try {
      const paths = temporaryPaths(root, 'a'.repeat(64), 1, 'b'.repeat(32), 'c'.repeat(64))

      assert.match(paths.electionAlias, /\.nightshift-init-backlog-election\.[a-f0-9]{64}\.tmp$/)
      assert.match(paths.electionOldWitness, /\.nightshift-init-backlog-election\.[a-f0-9]{64}\.old\.tmp$/)
      assert.match(paths.electionNewWitness, /\.nightshift-init-backlog-election\.[a-f0-9]{64}\.new\.tmp$/)
      assert.match(paths.electionTombstone, /\.nightshift-init-backlog-election\.[a-f0-9]{64}\.tombstone\.tmp$/)
      assert.equal(paths.election, paths.electionAlias)
      assert.equal(new Set([paths.electionAlias, paths.electionOldWitness, paths.electionNewWitness, paths.electionTombstone]).size, 4)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('preserves every fresh marker publication prefix exactly', () => {
    for (const prefix of [
      { alias: true, marker: false, newWitness: false, point: 'after-mode-assignment' },
      { alias: true, marker: false, newWitness: true, point: 'after-marker-new-witness' },
      { alias: true, marker: true, newWitness: true, linkCount: 3, point: 'after-marker-publication' },
      { alias: false, marker: true, newWitness: true, linkCount: 2, point: 'after-marker-alias-removal' },
    ]) {
      const root = fixtureRoot()
      try {
        const carried = inspection(root, { git: { ...inspection(root).git, electionRequired: true, kind: 'git', objectFormat: 'sha1', plansPolicy: 'satisfied' } })
        carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
        const applyRequest = request(root, { inspection: carried, versionControlChoice: 'track' })
        const manifestId = admitApplyManifest(applyRequest).manifestId
        const paths = temporaryPaths(root, manifestId, 1, 'a'.repeat(32), carried.snapshotId)
        const markerPath = join(root, ELECTION_MARKER_PATH)

        assert.throws(() => publishApply(applyRequest, { collectInspection: () => carried, crash: true, failAt: prefix.point, ownerNonce: 'a'.repeat(32) }), new RegExp(`Injected publication failure at ${prefix.point}`))
        assert.equal(existsSync(paths.electionAlias), prefix.alias)
        assert.equal(existsSync(paths.electionNewWitness), prefix.newWitness)
        assert.equal(existsSync(markerPath), prefix.marker)
        if (prefix.linkCount !== undefined) assert.equal(statSync(markerPath).nlink, prefix.linkCount)
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    }
  })

  test('replays the fresh marker triple-link prefix without restaging', () => {
    const root = fixtureRoot()
    try {
      const carried = inspection(root, { git: { ...inspection(root).git, electionRequired: true, kind: 'git', objectFormat: 'sha1', plansPolicy: 'satisfied' } })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const applyRequest = request(root, { inspection: carried, versionControlChoice: 'track' })
      const manifestId = admitApplyManifest(applyRequest).manifestId
      const paths = temporaryPaths(root, manifestId, 1, 'f'.repeat(32), carried.snapshotId)
      const markerPath = join(root, ELECTION_MARKER_PATH)

      assert.throws(() => publishApply(applyRequest, { collectInspection: () => carried, crash: true, failAt: 'after-marker-publication', ownerNonce: 'f'.repeat(32) }), /Injected publication failure at after-marker-publication/)
      assert.equal(statSync(markerPath).nlink, 3)
      assert.equal(statSync(paths.electionAlias).nlink, 3)
      const result = publishApply(applyRequest, { collectInspection: () => inspection(root, { git: { ...carried.git, electionMarker: 'track', electionMarkerMode: process.platform !== 'win32' ? 384 : null, electionMarkerSnapshotId: carried.snapshotId } }), ownerNonce: 'f'.repeat(32), resume: true })

      assert.equal(result.ok, true)
      assert.equal(existsSync(paths.electionAlias), false)
      assert.equal(existsSync(paths.electionNewWitness), false)
      assert.equal(existsSync(markerPath), false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('preserves every replacement marker publication prefix exactly', () => {
    for (const prefix of [
      { alias: false, marker: true, newWitness: false, oldWitness: true, markerLinks: 2, point: 'after-marker-old-witness' },
      { alias: true, marker: true, newWitness: false, oldWitness: true, markerLinks: 2, point: 'after-mode-assignment' },
      { alias: true, marker: true, newWitness: true, oldWitness: true, markerLinks: 2, point: 'after-marker-new-witness' },
      { alias: false, marker: true, newWitness: true, oldWitness: true, markerLinks: 2, point: 'after-marker-replacement' },
    ]) {
      const root = fixtureRoot()
      try {
        const carried = inspection(root, { git: { ...inspection(root).git, electionMarker: 'deferred', electionMarkerMode: process.platform === 'win32' ? null : 416, electionMarkerSnapshotId: 'a'.repeat(64), electionRequired: true, kind: 'git', objectFormat: 'sha1', plansPolicy: 'satisfied' } })
        carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
        const oldMarker = composeElectionMarker('deferred', 'git', true, carried.git.electionMarkerSnapshotId, carried.git.electionMarkerMode, root)
        const markerPath = join(root, ELECTION_MARKER_PATH)
        writeFileSync(markerPath, Buffer.from(oldMarker.contentBase64, 'base64'), { mode: carried.git.electionMarkerMode ?? 0o600 })
        const applyRequest = request(root, { inspection: carried, versionControlChoice: 'track' })
        const manifestId = admitApplyManifest(applyRequest).manifestId
        const paths = temporaryPaths(root, manifestId, 1, 'b'.repeat(32), carried.snapshotId)

        assert.throws(() => publishApply(applyRequest, { collectInspection: () => carried, crash: true, failAt: prefix.point, ownerNonce: 'b'.repeat(32) }), new RegExp(`Injected publication failure at ${prefix.point}`))
        assert.equal(existsSync(paths.electionAlias), prefix.alias)
        assert.equal(existsSync(paths.electionNewWitness), prefix.newWitness)
        assert.equal(existsSync(paths.electionOldWitness), prefix.oldWitness)
        assert.equal(existsSync(markerPath), prefix.marker)
        if (prefix.markerLinks !== undefined) assert.equal(statSync(markerPath).nlink, prefix.markerLinks)
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    }
  })

  test('preserves every terminal marker cleanup prefix exactly', () => {
    for (const prefix of [
      { alias: false, marker: false, newWitness: true, tombstone: true, point: 'after-marker-terminal-rename' },
      { alias: false, marker: false, newWitness: false, tombstone: true, point: 'after-marker-witness-removal' },
      { alias: false, marker: false, newWitness: false, tombstone: false, point: 'after-marker-tombstone-removal' },
    ]) {
      const root = fixtureRoot()
      try {
        const carried = inspection(root, { git: { ...inspection(root).git, electionRequired: true, kind: 'git', objectFormat: 'sha1', plansPolicy: 'satisfied' } })
        carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
        const applyRequest = request(root, { inspection: carried, versionControlChoice: 'track' })
        const manifestId = admitApplyManifest(applyRequest).manifestId
        const paths = temporaryPaths(root, manifestId, 1, 'c'.repeat(32), carried.snapshotId)
        const markerPath = join(root, ELECTION_MARKER_PATH)
        let collections = 0
        const collect = () => {
          collections += 1
          const markerPresent = existsSync(markerPath)

          return collections === 1 ? carried : inspection(root, { git: { ...carried.git, electionMarker: markerPresent ? 'track' : 'absent', electionMarkerMode: markerPresent && process.platform !== 'win32' ? 384 : null, electionMarkerSnapshotId: markerPresent ? carried.snapshotId : null } })
        }
        assert.throws(() => publishApply(applyRequest, { collectInspection: collect, crash: true, ownerNonce: 'c'.repeat(32), onPublished: (destination) => { if (destination.endsWith(ELECTION_MARKER_PATH)) throw new Error('response lost before terminal cleanup') } }), /response lost before terminal cleanup/)
        assert.throws(() => publishApply(applyRequest, { collectInspection: collect, ownerNonce: 'c'.repeat(32), failAt: prefix.point, resume: true }), new RegExp(`Injected publication failure at ${prefix.point}`))
        assert.equal(existsSync(paths.electionAlias), prefix.alias)
        assert.equal(existsSync(markerPath), prefix.marker)
        assert.equal(existsSync(paths.electionNewWitness), prefix.newWitness)
        assert.equal(existsSync(paths.electionTombstone), prefix.tombstone)
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    }
  })

  test('rejects an invalid second action before any publication write', () => {
    const root = fixtureRoot()
    let writes = 0
    try {
      const action = { id: 'p-invalid', kind: 'ensure-directory', mode: 493, target: '.claude/unknown' }
      expectCode(() => publishApply(request(root, { actions: [action] }), { currentInspection: inspection(root), writeSpy: () => { writes += 1 } }), 'manifest-invalid')
      assert.equal(writes, 0)
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('rejects a derived temporary path that collides with an action target', () => {
    const root = fixtureRoot()
    const ownerNonce = 'a'.repeat(32)
    let writes = 0
    try {
      const action = { id: 'p-temporary-target-collision', kind: 'ensure-directory', mode: process.platform === 'win32' ? null : 493, target: `.nightshift-init-backlog.${ownerNonce}.lock.next` }

      expectCode(() => publishApply(request(root, { actions: [action] }), { currentInspection: inspection(root), ownerNonce, writeSpy: () => { writes += 1 } }), 'manifest-invalid')
      assert.equal(writes, 0)
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('preserves an existing election marker mode when rebinding', () => {
    const root = fixtureRoot()
    try {
      const marker = composeElectionMarker('deferred', 'git', true, 'a'.repeat(64), 416, root)
      writeFileSync(join(root, ELECTION_MARKER_PATH), Buffer.from(marker.contentBase64, 'base64'), { mode: 416 })
      const carried = inspection(root, { git: { ...inspection(root).git, electionMarker: 'deferred', electionMarkerMode: 416, electionMarkerSnapshotId: 'a'.repeat(64), electionRequired: true, kind: 'git', objectFormat: 'sha1', plansPolicy: 'satisfied' } })
      const result = publishApply(request(root, { inspection: carried, versionControlChoice: 'deferred' }), { collectInspection: () => carried })

      assert.equal(result.ok, true)
      if (process.platform !== 'win32') assert.equal(statSync(join(root, ELECTION_MARKER_PATH)).mode & 0o777, 0o640)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('keeps a deferred Git election incomplete through the exact gitignore target', () => {
    const root = fixtureRoot()
    try {
      const carried = inspection(root, { git: { ...inspection(root).git, electionMarker: 'deferred', electionMarkerMode: process.platform === 'win32' ? null : 384, electionMarkerSnapshotId: 'a'.repeat(64), electionRequired: true, kind: 'git', objectFormat: 'sha1', plansPolicy: 'satisfied' } })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const post = inspection(root, { git: { ...carried.git, electionMarker: 'deferred', electionMarkerMode: process.platform === 'win32' ? null : 384, electionMarkerSnapshotId: carried.snapshotId, electionRequired: true } })
      const result = publishApply(request(root, { inspection: carried, versionControlChoice: 'deferred' }), { currentInspection: carried, collectInspection: () => post })

      assert.equal(result.complete, false)
      assert.deepEqual(result.incompleteTargets, ['.gitignore'])
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('resumes a response-loss prefix by recognizing the published target', () => {
    const root = fixtureRoot()
    try {
      const fileBytes = Buffer.from('approved\n', 'utf8')
      const fileMode = process.platform === 'win32' ? null : 420
      const action = { id: 'p-response-loss', kind: 'create-from-template', mode: fileMode, newline: 'lf', target: 'FEATURES.md', templateId: 'backlog.features' }
      const carried = inspection(root, {
        ready: analyzeCatalog([{ contents: 'approved\n', target: 'FEATURES.md' }]),
        targets: [{ bom: null, cleanTextSha256: null, contentBase64: null, contentRole: 'semantic', editableRegions: [], finalNewline: null, kind: 'file', mode: fileMode, newline: null, rawSha256: null, states: ['missing'], target: 'FEATURES.md', templateId: 'backlog.features', templateSha256: 'a'.repeat(64) }],
        proposals: [{ action, afterBase64: fileBytes.toString('base64'), beforeBase64: null, condition: 'always', proposalId: action.id, reason: 'missing-target' }],
        templates: [{ conceptIds: [], logicalSha256: 'a'.repeat(64), target: 'FEATURES.md', templateId: 'backlog.features' }],
      })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const applyRequest = request(root, { actions: [action], inspection: carried, proposalDispositions: [{ disposition: 'selected', proposalId: action.id }], semanticDecisions: [{ conceptIds: [], status: 'satisfied', target: 'FEATURES.md' }] })
      const live = inspection(root, { proposals: carried.proposals, ready: carried.ready, targets: [{ ...carried.targets[0], contentBase64: fileBytes.toString('base64'), rawSha256: sha256(fileBytes), states: ['present'] }], templates: carried.templates })
      let collectionCount = 0
      const collect = () => {
        collectionCount += 1

        return collectionCount === 1 ? carried : live
      }

      assert.throws(() => publishApply(applyRequest, { collectInspection: collect, failAt: 'after-final-verification' }))
      assert.equal(existsSync(join(root, 'FEATURES.md')), true)
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), true)
      const resumed = publishApply(applyRequest, { resume: true, collectInspection: collect })

      assert.deepEqual(resumed.outcomes, [{ actionId: action.id, status: 'skipped-complete', target: action.target }])
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('resume comparison preserves unrelated diagnostic and warning drift', () => {
    const root = fixtureRoot()
    try {
      const fixture = resumableCreateFixture(root)
      const live = inspection(root, {
        ...fixture.live,
        problems: [{ blocking: false, code: 'ready-notice', detail: 'Unrelated notice changed.', evidencePaths: ['OTHER.md'], target: 'OTHER.md' }],
        warnings: [{ code: 'nonblocking-ready-notice', detail: '1 ready notice remains.', target: 'OTHER.md' }],
      })

      expectCode(() => publishApply(fixture.applyRequest, { collectInspection: () => live, resume: true }), 'snapshot-drift')
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), false)
      const controlled = inspection(root, {
        ...fixture.live,
        problems: [{ blocking: false, code: 'ready-notice', detail: 'Controlled notice changed.', evidencePaths: ['FEATURES.md'], target: 'FEATURES.md' }],
        warnings: [{ code: 'nonblocking-ready-notice', detail: '1 ready notice remains.', target: 'FEATURES.md' }],
      })
      assert.equal(publishApply(fixture.applyRequest, { collectInspection: () => controlled, resume: true }).ok, true, 'diagnostics owned by the approved target remain resumable')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  for (const scenario of [
    { name: '.gitattributes', mutate: (root) => writeFileSync(join(root, '.gitattributes'), '*.md -text\n') },
    { name: 'core.autocrlf', mutate: (root) => git(root, ['config', '--local', 'core.autocrlf', 'input']) },
    { name: 'core.eol', mutate: (root) => git(root, ['config', '--local', 'core.eol', 'lf']) },
  ]) {
    test(`resume rejects ${scenario.name} newline policy drift`, () => {
      const root = fixtureRoot()
      try {
        const { applyRequest, carried, collect } = realGitScaffoldFixture(root)
        const actionTargets = new Set(applyRequest.actions.map((action) => action.target))
        const actionPolicies = (inspection) => inspection.git.newlinePolicies.filter((policy) => actionTargets.has(policy.target))

        assert.throws(() => publishApply(applyRequest, { crash: true, currentInspection: carried, failAt: 'after-lock-upgrade' }), /Injected publication failure at after-lock-upgrade/)
        scenario.mutate(root)
        const live = collect()
        assert.notDeepEqual(actionPolicies(live), actionPolicies(carried), scenario.name)

        expectCode(() => publishApply(applyRequest, { collectInspection: () => live, resume: true }), 'snapshot-drift')
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    })
  }

  for (const scenario of [
    { name: 'file-prefix', stopAfter: 1 },
    { name: 'completion', stopAfter: Number.POSITIVE_INFINITY },
  ]) {
    test(`resume accepts non-Git platform-to-siblings newline policy transitions after ${scenario.name}`, () => {
      const root = fixtureRoot()
      try {
        const { applyRequest, carried, collect } = realNonGitScaffoldFixture(root)
        const fileActions = applyRequest.actions.filter((action) => action.kind !== 'ensure-directory')
        const actionTargets = new Set(fileActions.map((action) => action.target))
        const actionPaths = new Set([...actionTargets].map((target) => join(root, ...target.split('/'))))
        const stopAfter = scenario.stopAfter === Number.POSITIVE_INFINITY ? fileActions.length : scenario.stopAfter
        let publicationCount = 0
        let stopPending = false

        assert.throws(() => publishApply(applyRequest, {
          crash: true,
          currentInspection: carried,
          onPublished: (destination) => {
            if (!actionPaths.has(destination)) return
            publicationCount += 1
            stopPending = publicationCount === stopAfter
          },
          onTransition: (point) => { if (stopPending && point === 'after-temporary-cleanup') throw new Error(`crash after ${scenario.name}`) },
        }), new RegExp(`crash after ${scenario.name}`))
        const progress = approvedProgress(applyRequest, root, {})
        assert.equal(progress.recognized, true, canonicalJson(progress))
        assert.ok(progress.applied > 0, canonicalJson(progress))
        assert.equal(progress.applied === applyRequest.actions.length, scenario.name === 'completion', canonicalJson(progress))
        const live = collect()
        const carriedPolicies = new Map(carried.git.newlinePolicies.map((policy) => [policy.target, policy]))
        const transitioned = live.git.newlinePolicies.filter((policy) => actionTargets.has(policy.target) && carriedPolicies.get(policy.target)?.source === 'platform' && policy.source === 'siblings')
        assert.ok(transitioned.length > 0, canonicalJson({ carried: carried.git.newlinePolicies, live: live.git.newlinePolicies }))

        assert.equal(publishApply(applyRequest, { collectInspection: collect, resume: true }).ok, true)
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    })
  }

  test('resume rejects nested ignore drift before root gitignore publication', () => {
    const root = fixtureRoot()
    try {
      const { applyRequest, carried, collect } = realGitScaffoldFixture(root)

      assert.throws(() => publishApply(applyRequest, { crash: true, currentInspection: carried, failAt: 'after-lock-upgrade' }), /Injected publication failure at after-lock-upgrade/)
      const nestedIgnore = Buffer.from('plans/\n', 'utf8')
      writeFileSync(join(root, '.claude', '.gitignore'), nestedIgnore)

      assert.throws(
        () => publishApply(applyRequest, { collectInspection: collect, resume: true }),
        (error) => {
          assert.equal(error?.record?.code, 'snapshot-drift', canonicalJson(error?.record ?? {}))

          return true
        },
      )
      assert.equal(existsSync(join(root, '.claude', 'FEATURES.md')), false, 'resume drift must stop before the first approved project action')
      assert.deepEqual(readFileSync(join(root, '.claude', '.gitignore')), nestedIgnore)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('resume preserves nested ignore evidence after root gitignore publication', () => {
    const root = fixtureRoot()
    try {
      const initial = realGitScaffoldFixture(root)
      assert.equal(publishApply(initial.applyRequest, { collectInspection: initial.collect }).ok, true)
      rmSync(join(root, '.gitignore'))
      const carried = initial.collect()
      const applyRequest = approvedScaffoldRequest(root, initial.context, carried, 'not-required')
      let rootIgnorePublished = false
      assert.throws(() => publishApply(applyRequest, {
        crash: true,
        currentInspection: carried,
        onPublished: (path) => { rootIgnorePublished = path === join(root, '.gitignore') || rootIgnorePublished },
        onTransition: (point) => { if (rootIgnorePublished && point === 'after-temporary-cleanup') throw new Error('crash after root ignore publication') },
      }), /crash after root ignore publication/)
      assert.equal(existsSync(join(root, '.gitignore')), true)
      assert.equal(existsSync(join(root, ELECTION_MARKER_PATH)), false, 'the crash must precede election marker publication')
      const nestedIgnore = Buffer.from('plans/\n', 'utf8')
      writeFileSync(join(root, '.claude', '.gitignore'), nestedIgnore)

      assert.throws(
        () => publishApply(applyRequest, { collectInspection: initial.collect, resume: true }),
        (error) => {
          assert.equal(error?.record?.code, 'snapshot-drift', canonicalJson(error?.record ?? {}))

          return true
        },
      )
      assert.deepEqual(readFileSync(join(root, '.claude', '.gitignore')), nestedIgnore)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('resume comparison preserves unrelated guidance graph drift', () => {
    const root = fixtureRoot()
    try {
      const fixture = resumableCreateFixture(root, 'AGENTS.md')
      const live = inspection(root, {
        ...fixture.live,
        guidance: { ...fixture.carried.guidance, candidates: ['AGENTS.md', 'OTHER.md'], graphPaths: ['AGENTS.md', 'OTHER.md'], independentPaths: ['OTHER.md'] },
      })

      expectCode(() => publishApply(fixture.applyRequest, { collectInspection: () => live, resume: true }), 'snapshot-drift')
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), false)
      const controlled = inspection(root, { ...fixture.live, guidance: { ...fixture.carried.guidance, candidates: ['AGENTS.md'], graphPaths: ['AGENTS.md'] } })
      assert.equal(publishApply(fixture.applyRequest, { collectInspection: () => controlled, resume: true }).ok, true, 'guidance records owned by the approved target remain resumable')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('resume comparison preserves unrelated retained-backup drift during unwrap', () => {
    const fixture = unwrapBackupFailureFixture()
    try {
      const carried = fixture.applyRequest.inspection
      writeFileSync(join(fixture.root, fixture.target), fixture.unwrapped)
      const unrelatedBackup = `.tmp/nightshift-init-backlog-unwrap-${'a'.repeat(64)}-${'b'.repeat(64)}-${'c'.repeat(64)}.bak`
      const live = inspection(fixture.root, {
        proposals: carried.proposals,
        ready: carried.unwrapReady.after,
        retainedBackups: [unrelatedBackup],
        targets: [{ ...carried.targets[0], contentBase64: fixture.unwrapped.toString('base64'), rawSha256: sha256(fixture.unwrapped), states: ['present'] }],
        templates: carried.templates,
        unwrapReady: { after: carried.unwrapReady.after, targets: [] },
        warnings: [{ code: 'manual-cleanup', detail: 'One retained unwrap backup requires manual cleanup.', target: unrelatedBackup }],
        wrapFindings: [],
      })

      expectCode(() => publishApply(fixture.applyRequest, { collectInspection: () => live, resume: true }), 'snapshot-drift')
      assert.equal(existsSync(join(fixture.root, '.nightshift-init-backlog.lock')), false)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('resume comparison preserves same-target backups from another transition', () => {
    const fixture = unwrapBackupFailureFixture()
    try {
      const carried = fixture.applyRequest.inspection
      const manifestId = admitApplyManifest(fixture.applyRequest).manifestId
      const foreignSnapshotId = carried.snapshotId === 'a'.repeat(64) ? 'b'.repeat(64) : 'a'.repeat(64)
      const foreignManifestId = manifestId === 'c'.repeat(64) ? 'd'.repeat(64) : 'c'.repeat(64)
      const targetHash = sha256(Buffer.from(fixture.target, 'utf8'))
      const foreignBackup = `.tmp/nightshift-init-backlog-unwrap-${foreignSnapshotId}-${foreignManifestId}-${targetHash}.bak`
      writeFileSync(join(fixture.root, fixture.target), fixture.unwrapped)
      const live = inspection(fixture.root, {
        proposals: carried.proposals,
        ready: carried.unwrapReady.after,
        retainedBackups: [foreignBackup],
        targets: [{ ...carried.targets[0], contentBase64: fixture.unwrapped.toString('base64'), rawSha256: sha256(fixture.unwrapped), states: ['present'] }],
        templates: carried.templates,
        unwrapReady: { after: carried.unwrapReady.after, targets: [] },
        warnings: [{ code: 'manual-cleanup', detail: 'One retained unwrap backup requires manual cleanup.', target: foreignBackup }],
        wrapFindings: [],
      })

      expectCode(() => publishApply(fixture.applyRequest, { collectInspection: () => live, resume: true }), 'snapshot-drift')
      assert.equal(existsSync(join(fixture.root, '.nightshift-init-backlog.lock')), false)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('resumes a response-loss prefix after election-marker publication from live state', () => {
    const root = fixtureRoot()
    try {
      const carried = inspection(root, { git: { ...inspection(root).git, electionMarker: 'absent', electionMarkerMode: null, electionMarkerSnapshotId: null, electionRequired: true, kind: 'git', objectFormat: 'sha1', plansPolicy: 'satisfied' } })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      let collectionCount = 0
      const collect = () => {
        collectionCount += 1
        if (collectionCount === 1) return carried
        const markerPresent = existsSync(join(root, ELECTION_MARKER_PATH))
        const markerState = markerPresent ? 'track' : 'absent'
        const markerMode = markerPresent && process.platform !== 'win32' ? 384 : null

        return inspection(root, { git: { ...carried.git, electionMarker: markerState, electionMarkerMode: markerMode, electionMarkerSnapshotId: markerPresent ? carried.snapshotId : null } })
      }
      const applyRequest = request(root, { inspection: carried, versionControlChoice: 'track' })

      assert.throws(() => publishApply(applyRequest, { collectInspection: collect, failAt: 'after-final-verification' }))
      const result = publishApply(applyRequest, { collectInspection: collect, resume: true })

      assert.equal(result.ok, true)
      assert.equal(result.postInspect.git.electionMarker, 'absent')
      assert.equal(existsSync(join(root, ELECTION_MARKER_PATH)), false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('resumes an existing election-marker replacement after response loss from live state', () => {
    const root = fixtureRoot()
    try {
      const carried = inspection(root, { git: { ...inspection(root).git, electionMarker: 'deferred', electionMarkerMode: process.platform === 'win32' ? null : 416, electionMarkerSnapshotId: 'a'.repeat(64), electionRequired: true, kind: 'git', objectFormat: 'sha1', plansPolicy: 'satisfied' } })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const marker = composeElectionMarker('deferred', 'git', true, carried.git.electionMarkerSnapshotId, carried.git.electionMarkerMode, root)
      writeFileSync(join(root, ELECTION_MARKER_PATH), Buffer.from(marker.contentBase64, 'base64'), { mode: carried.git.electionMarkerMode ?? 0o600 })
      const applyRequest = request(root, { inspection: carried, versionControlChoice: 'track' })
      let collectionCount = 0
      const collect = () => {
        collectionCount += 1
        if (collectionCount === 1) return carried
        const markerPresent = existsSync(join(root, ELECTION_MARKER_PATH))

        return inspection(root, { git: { ...carried.git, electionMarker: markerPresent ? 'track' : 'absent', electionMarkerMode: markerPresent && process.platform !== 'win32' ? carried.git.electionMarkerMode : null, electionMarkerSnapshotId: markerPresent ? carried.snapshotId : null } })
      }

      assert.throws(() => publishApply(applyRequest, { collectInspection: collect, crash: true, failAt: 'after-final-verification', onRenamed: (destination) => { if (destination.endsWith(ELECTION_MARKER_PATH)) throw new Error('response lost after marker replacement') } }), /response lost after marker replacement/)
      assert.equal(existsSync(join(root, ELECTION_MARKER_PATH)), true)
      const result = publishApply(applyRequest, { collectInspection: collect, resume: true })

      assert.equal(result.ok, true)
      assert.equal(result.postInspect.git.electionMarker, 'absent')
      assert.equal(existsSync(join(root, ELECTION_MARKER_PATH)), false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('retains a successor marker when replacement response-loss cleanup changes identity', () => {
    const root = fixtureRoot()
    try {
      const carried = inspection(root, { git: { ...inspection(root).git, electionMarker: 'deferred', electionMarkerMode: process.platform === 'win32' ? null : 416, electionMarkerSnapshotId: 'a'.repeat(64), electionRequired: true, kind: 'git', objectFormat: 'sha1', plansPolicy: 'satisfied' } })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const marker = composeElectionMarker('deferred', 'git', true, carried.git.electionMarkerSnapshotId, carried.git.electionMarkerMode, root)
      const markerPath = join(root, ELECTION_MARKER_PATH)
      writeFileSync(markerPath, Buffer.from(marker.contentBase64, 'base64'), { mode: carried.git.electionMarkerMode ?? 0o600 })
      const applyRequest = request(root, { inspection: carried, versionControlChoice: 'track' })
      let collectionCount = 0
      const collect = () => {
        collectionCount += 1
        const present = existsSync(markerPath)
        const live = inspection(root, { git: { ...carried.git, electionMarker: present ? 'track' : 'absent', electionMarkerMode: present && process.platform !== 'win32' ? carried.git.electionMarkerMode : null, electionMarkerSnapshotId: present ? carried.snapshotId : null } })
        if (collectionCount === 3 && present) {
          const bytes = readFileSync(markerPath)
          rmSync(markerPath)
          writeFileSync(markerPath, bytes, { mode: carried.git.electionMarkerMode ?? 0o600 })
        }

        return collectionCount === 1 ? carried : live
      }

      assert.throws(() => publishApply(applyRequest, { collectInspection: collect, failAt: 'after-final-verification', onRenamed: (destination) => { if (destination.endsWith(ELECTION_MARKER_PATH)) throw new Error('response lost after marker replacement') } }), /response lost after marker replacement/)
      assert.throws(() => publishApply(applyRequest, { collectInspection: collect, preserveLockOnError: true, resume: true }), /Election marker changed before cleanup/)
      assert.equal(existsSync(markerPath), true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('adopts an inventoried action temporary when resuming after staging', () => {
    const root = fixtureRoot()
    try {
      const fileBytes = Buffer.from('approved\n', 'utf8')
      const fileMode = process.platform === 'win32' ? null : 420
      const action = { id: 'p-action-temp-resume', kind: 'create-from-template', mode: fileMode, newline: 'lf', target: 'FEATURES.md', templateId: 'backlog.features' }
      const carried = inspection(root, { ready: analyzeCatalog([{ contents: 'approved\n', target: 'FEATURES.md' }]), targets: [{ bom: null, cleanTextSha256: null, contentBase64: null, contentRole: 'semantic', editableRegions: [], finalNewline: null, kind: 'file', mode: fileMode, newline: null, rawSha256: null, states: ['missing'], target: action.target, templateId: action.templateId, templateSha256: 'a'.repeat(64) }], proposals: [{ action, afterBase64: fileBytes.toString('base64'), beforeBase64: null, condition: 'always', proposalId: action.id, reason: 'missing-target' }], templates: [{ conceptIds: [], logicalSha256: 'a'.repeat(64), target: action.target, templateId: action.templateId }] })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const applyRequest = request(root, { actions: [action], inspection: carried, proposalDispositions: [{ disposition: 'selected', proposalId: action.id }], semanticDecisions: [{ conceptIds: [], status: 'satisfied', target: action.target }] })
      const manifestId = admitApplyManifest(applyRequest).manifestId
      const temporary = temporaryPaths(root, manifestId, 1, 'e'.repeat(32), carried.snapshotId, process.pid, action.target).action

      assert.throws(() => publishApply(applyRequest, { currentInspection: carried, crash: true, failAt: 'after-mode-assignment', ownerNonce: 'e'.repeat(32) }), /Injected publication failure at after-mode-assignment/)
      assert.equal(existsSync(temporary), true)
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), true)
      const result = publishApply(applyRequest, { collectInspection: () => carried, ownerNonce: 'e'.repeat(32), resume: true })

      assert.deepEqual(result.outcomes, [{ actionId: action.id, status: 'created', target: action.target }])
      assert.equal(existsSync(temporary), false)
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('adopts an inventoried election temporary when resuming after marker staging', () => {
    const root = fixtureRoot()
    try {
      const carried = inspection(root, { git: { ...inspection(root).git, electionRequired: true, kind: 'git', objectFormat: 'sha1', plansPolicy: 'satisfied' } })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const applyRequest = request(root, { inspection: carried, versionControlChoice: 'track' })
      const manifestId = admitApplyManifest(applyRequest).manifestId
      const temporary = temporaryPaths(root, manifestId, 1, 'f'.repeat(32), carried.snapshotId).election
      let collections = 0
      const collect = () => {
        collections += 1
        const present = existsSync(join(root, ELECTION_MARKER_PATH))

        return inspection(root, { git: { ...carried.git, electionMarker: present ? 'track' : 'absent', electionMarkerMode: present && process.platform !== 'win32' ? 384 : null, electionMarkerSnapshotId: present ? carried.snapshotId : null } })
      }

      assert.throws(() => publishApply(applyRequest, { collectInspection: collect, crash: true, failAt: 'after-mode-assignment', ownerNonce: 'f'.repeat(32) }), /Injected publication failure at after-mode-assignment/)
      assert.equal(existsSync(temporary), true)
      const writes = []
      const result = publishApply(applyRequest, { collectInspection: collect, ownerNonce: 'f'.repeat(32), resume: true, writeSpy: (path) => { writes.push(path) } })

      assert.equal(result.postInspect.git.electionMarker, 'absent')
      assert.equal(writes.some((path) => path.endsWith(ELECTION_MARKER_PATH)), true)
      assert.equal(existsSync(temporary), false)
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('does not recreate a removed election marker when resuming after its final write', () => {
    const root = fixtureRoot()
    try {
      const action = { id: 'p-marker-replay', kind: 'ensure-directory', mode: process.platform === 'win32' ? null : 493, target: '.claude' }
      const carried = inspection(root, { git: { ...inspection(root).git, electionRequired: true, kind: 'git', objectFormat: 'sha1', plansPolicy: 'satisfied' }, targets: [{ bom: null, cleanTextSha256: null, contentBase64: null, contentRole: 'none', editableRegions: [], finalNewline: null, kind: 'directory', mode: action.mode, newline: null, rawSha256: null, states: ['missing'], target: action.target, templateId: null, templateSha256: null }], proposals: [{ action, afterBase64: null, beforeBase64: null, condition: 'always', proposalId: action.id, reason: 'missing-target' }] })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      let collectionCount = 0
      const collect = () => {
        collectionCount += 1
        if (collectionCount === 1) return carried
        const markerPresent = existsSync(join(root, ELECTION_MARKER_PATH))
        return inspection(root, { git: { ...carried.git, electionMarker: markerPresent ? 'track' : 'absent', electionMarkerMode: markerPresent && process.platform !== 'win32' ? 384 : null, electionMarkerSnapshotId: markerPresent ? carried.snapshotId : null }, proposals: carried.proposals, targets: [{ ...carried.targets[0], states: ['present'] }] })
      }
      const applyRequest = request(root, { actions: [action], inspection: carried, proposalDispositions: [{ disposition: 'selected', proposalId: action.id }], versionControlChoice: 'track' })
      assert.throws(() => publishApply(applyRequest, { collectInspection: collect, failAt: 'after-marker-removal' }))
      assert.equal(existsSync(join(root, ELECTION_MARKER_PATH)), false)
      const writes = []
      const result = publishApply(applyRequest, { collectInspection: collect, resume: true, writeSpy: (path) => { writes.push(path) } })

      assert.equal(result.postInspect.git.electionMarker, 'absent')
      assert.equal(writes.some((path) => path.endsWith(ELECTION_MARKER_PATH)), false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('binds marker replacement to the approved carried marker bytes and mode', () => {
    const root = fixtureRoot()
    try {
      const carried = inspection(root, { git: { ...inspection(root).git, electionMarker: 'deferred', electionMarkerMode: process.platform === 'win32' ? null : 416, electionMarkerSnapshotId: 'a'.repeat(64), electionRequired: true, kind: 'git', objectFormat: 'sha1', plansPolicy: 'satisfied' } })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const approved = composeElectionMarker('deferred', 'git', true, carried.snapshotId, carried.git.electionMarkerMode, root)
      const external = Buffer.from('{"protocolVersion":1,"root":"wrong","snapshotId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","state":"deferred"}\n', 'utf8')
      writeFileSync(join(root, ELECTION_MARKER_PATH), external, { mode: carried.git.electionMarkerMode ?? 0o600 })
      const applyRequest = request(root, { inspection: carried, versionControlChoice: 'track' })

      assert.throws(() => publishApply(applyRequest, { currentInspection: carried }))
      assert.deepEqual(readFileSync(join(root, ELECTION_MARKER_PATH)), external)
      assert.notDeepEqual(readFileSync(join(root, ELECTION_MARKER_PATH)), Buffer.from(approved.contentBase64, 'base64'))
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('rejects a marker replacement whose live mode changed after inspection', () => {
    const root = fixtureRoot()
    try {
      const carriedMode = process.platform === 'win32' ? null : 416
      const marker = composeElectionMarker('deferred', 'git', true, 'a'.repeat(64), carriedMode, root)
      const markerPath = join(root, ELECTION_MARKER_PATH)
      writeFileSync(markerPath, Buffer.from(marker.contentBase64, 'base64'), { mode: carriedMode ?? 0o600 })
      const carried = inspection(root, { git: { ...inspection(root).git, electionMarker: 'deferred', electionMarkerMode: carriedMode, electionMarkerSnapshotId: 'a'.repeat(64), electionRequired: true, kind: 'git', objectFormat: 'sha1', plansPolicy: 'satisfied' } })
      const applyRequest = request(root, { inspection: carried, versionControlChoice: 'track' })

      if (process.platform !== 'win32') {
        expectCode(() => publishApply(applyRequest, { collectInspection: () => carried, onTransition: (point) => { if (point === 'after-lock-upgrade') chmodSync(markerPath, 384) } }), 'filesystem')
        assert.equal(statSync(markerPath).mode & 0o777, 0o600)
      }
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('rechecks owned temporary identity and bytes before successful cleanup', () => {
    const root = fixtureRoot()
    try {
      const bytes = Buffer.from('approved\n', 'utf8')
      const action = { id: 'p-temporary-ownership', kind: 'create-from-template', mode: process.platform === 'win32' ? null : 420, newline: 'lf', target: 'FEATURES.md', templateId: 'backlog.features' }
      const carried = inspection(root, { ready: analyzeCatalog([{ contents: 'approved\n', target: 'FEATURES.md' }]), targets: [{ bom: null, cleanTextSha256: null, contentBase64: null, contentRole: 'semantic', editableRegions: [], finalNewline: null, kind: 'file', mode: action.mode, newline: null, rawSha256: null, states: ['missing'], target: action.target, templateId: action.templateId, templateSha256: 'a'.repeat(64) }], proposals: [{ action, afterBase64: bytes.toString('base64'), beforeBase64: null, condition: 'always', proposalId: action.id, reason: 'missing-target' }], templates: [{ conceptIds: [], logicalSha256: 'a'.repeat(64), target: action.target, templateId: action.templateId }] })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const applyRequest = request(root, { actions: [action], inspection: carried, proposalDispositions: [{ disposition: 'selected', proposalId: action.id }], semanticDecisions: [{ conceptIds: [], status: 'satisfied', target: action.target }] })
      const manifestId = admitApplyManifest(applyRequest).manifestId
      const temporary = temporaryPaths(root, manifestId, 1, 'd'.repeat(32), carried.snapshotId, process.pid, action.target).action
      const external = Buffer.from('external\n', 'utf8')

      expectCode(() => publishApply(applyRequest, { currentInspection: carried, ownerNonce: 'd'.repeat(32), onTransition: (point) => { if (point === 'after-mode-assignment') { rmSync(temporary, { force: true }); writeFileSync(temporary, external) } } }), 'cleanup-failed')
      assert.deepEqual(readFileSync(temporary), external)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('rejects an external hard link to a staged temporary before target publication', () => {
    const root = fixtureRoot()
    try {
      const bytes = Buffer.from('approved\n', 'utf8')
      const action = { id: 'p-hard-link-temporary', kind: 'create-from-template', mode: process.platform === 'win32' ? null : 420, newline: 'lf', target: 'FEATURES.md', templateId: 'backlog.features' }
      const carried = inspection(root, { ready: analyzeCatalog([{ contents: 'approved\n', target: 'FEATURES.md' }]), targets: [{ bom: null, cleanTextSha256: null, contentBase64: null, contentRole: 'semantic', editableRegions: [], finalNewline: null, kind: 'file', mode: action.mode, newline: null, rawSha256: null, states: ['missing'], target: action.target, templateId: action.templateId, templateSha256: 'a'.repeat(64) }], proposals: [{ action, afterBase64: bytes.toString('base64'), beforeBase64: null, condition: 'always', proposalId: action.id, reason: 'missing-target' }], templates: [{ conceptIds: [], logicalSha256: 'a'.repeat(64), target: action.target, templateId: action.templateId }] })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const applyRequest = request(root, { actions: [action], inspection: carried, proposalDispositions: [{ disposition: 'selected', proposalId: action.id }], semanticDecisions: [{ conceptIds: [], status: 'satisfied', target: action.target }] })
      const manifestId = admitApplyManifest(applyRequest).manifestId
      const temporary = temporaryPaths(root, manifestId, 1, '9'.repeat(32), carried.snapshotId, process.pid, action.target).action
      const external = join(root, 'external-temporary-link')

      if (process.platform !== 'win32') {
        expectCode(() => publishApply(applyRequest, { currentInspection: carried, ownerNonce: '9'.repeat(32), onTransition: (point) => { if (point === 'after-mode-assignment') linkSync(temporary, external) } }), 'cleanup-failed')
        assert.equal(existsSync(join(root, 'FEATURES.md')), false)
        assert.equal(existsSync(temporary), true)
        assert.equal(existsSync(external), true)
        assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), true)
      }
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('reinspects the live repository before acquiring the publication lock', () => {
    const root = fixtureRoot()
    let writes = 0
    try {
      const live = inspection(root, { warnings: [{ code: 'runtime-support-created', detail: 'drift', target: null }] })

      expectCode(() => publishApply(request(root), { collectInspection: () => live, writeSpy: () => { writes += 1 } }), 'snapshot-drift')
      assert.equal(writes, 0)
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('retains a colliding reserved temporary without unlinking the external file', () => {
    const root = fixtureRoot()
    try {
      const action = { id: 'p-collision', kind: 'create-from-template', mode: process.platform === 'win32' ? null : 420, newline: 'lf', target: 'FEATURES.md', templateId: 'backlog.features' }
      const bytes = Buffer.from('approved\n', 'utf8')
      const carried = inspection(root, {
        ready: analyzeCatalog([{ contents: 'approved\n', target: 'FEATURES.md' }]),
        targets: [{ bom: null, cleanTextSha256: null, contentBase64: null, contentRole: 'semantic', editableRegions: [], finalNewline: null, kind: 'file', mode: action.mode, newline: null, rawSha256: null, states: ['missing'], target: action.target, templateId: action.templateId, templateSha256: 'a'.repeat(64) }],
        proposals: [{ action, afterBase64: bytes.toString('base64'), beforeBase64: null, condition: 'always', proposalId: action.id, reason: 'missing-target' }],
        templates: [{ conceptIds: [], logicalSha256: 'a'.repeat(64), target: action.target, templateId: action.templateId }],
      })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const applyRequest = request(root, { actions: [action], inspection: carried, proposalDispositions: [{ disposition: 'selected', proposalId: action.id }], semanticDecisions: [{ conceptIds: [], status: 'satisfied', target: action.target }] })
      const manifestId = admitApplyManifest(applyRequest).manifestId
      const collision = temporaryPaths(root, manifestId, 1, 'b'.repeat(32), carried.snapshotId, process.pid, action.target).action
      writeFileSync(collision, Buffer.from('external\n', 'utf8'))
      let writes = 0

      expectCode(() => publishApply(applyRequest, { currentInspection: carried, ownerNonce: 'b'.repeat(32), writeSpy: () => { writes += 1 } }), 'runtime-lock')
      assert.equal(writes, 0)
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), false)
      assert.deepEqual(readFileSync(collision), Buffer.from('external\n', 'utf8'))
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('rejects a colliding reserved temporary during automatic durable-progress resume', () => {
    const root = fixtureRoot()
    try {
      const fixture = resumableCreateFixture(root)
      const ownerNonce = '3'.repeat(32)
      const manifestId = admitApplyManifest(fixture.applyRequest).manifestId
      const collision = temporaryPaths(root, manifestId, 1, ownerNonce, fixture.carried.snapshotId, process.pid, fixture.applyRequest.actions[0].target).action
      const external = Buffer.from('approved\n', 'utf8')
      writeFileSync(collision, external, { mode: 0o644 })
      let writes = 0

      expectCode(() => publishApply(fixture.applyRequest, { collectInspection: () => fixture.live, ownerNonce, writeSpy: () => { writes += 1 } }), 'runtime-lock')
      assert.equal(writes, 0)
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), false)
      assert.deepEqual(readFileSync(collision), external)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('rejects a colliding marker witness before any publication write', () => {
    const root = fixtureRoot()
    try {
      const carried = inspection(root, { git: { ...inspection(root).git, electionRequired: true, kind: 'git', objectFormat: 'sha1', plansPolicy: 'satisfied' } })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const applyRequest = request(root, { inspection: carried, versionControlChoice: 'track' })
      const manifestId = admitApplyManifest(applyRequest).manifestId
      const paths = temporaryPaths(root, manifestId, 1, 'd'.repeat(32), carried.snapshotId)
      const external = Buffer.from('external witness\n', 'utf8')
      writeFileSync(paths.electionNewWitness, external, { mode: 0o600 })
      const writes = []

      expectCode(() => publishApply(applyRequest, { collectInspection: () => carried, ownerNonce: 'd'.repeat(32), writeSpy: (path) => { writes.push(path) } }), 'runtime-lock')
      assert.deepEqual(readFileSync(paths.electionNewWitness), external)
      assert.deepEqual(writes, [])
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('retains a marker witness when an external hard link appears before cleanup', () => {
    const root = fixtureRoot()
    try {
      const carried = inspection(root, { git: { ...inspection(root).git, electionRequired: true, kind: 'git', objectFormat: 'sha1', plansPolicy: 'satisfied' } })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const applyRequest = request(root, { inspection: carried, versionControlChoice: 'track' })
      const manifestId = admitApplyManifest(applyRequest).manifestId
      const paths = temporaryPaths(root, manifestId, 1, 'e'.repeat(32), carried.snapshotId)
      const markerPath = join(root, ELECTION_MARKER_PATH)
      const externalPath = join(root, 'external-witness-link')
      let collections = 0
      const collect = () => {
        collections += 1
        const markerPresent = existsSync(markerPath)
        if (collections === 2) linkSync(paths.electionNewWitness, externalPath)

        return collections === 1 ? carried : inspection(root, { git: { ...carried.git, electionMarker: markerPresent ? 'track' : 'absent', electionMarkerMode: markerPresent && process.platform !== 'win32' ? 384 : null, electionMarkerSnapshotId: markerPresent ? carried.snapshotId : null } })
      }
      assert.throws(() => publishApply(applyRequest, { collectInspection: collect, crash: true, ownerNonce: 'e'.repeat(32), onPublished: (destination) => { if (destination.endsWith(ELECTION_MARKER_PATH)) throw new Error('response lost before witness mutation') } }), /response lost before witness mutation/)
      assert.throws(() => publishApply(applyRequest, { collectInspection: collect, ownerNonce: 'e'.repeat(32), preserveLockOnError: true, resume: true }), /Election marker temporary differs from its approved image/)
      assert.equal(existsSync(paths.electionNewWitness), true)
      assert.equal(existsSync(externalPath), true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('publishes the election marker before dependent target writes and clears it on completion', () => {
    const root = fixtureRoot()
    try {
      const action = { id: 'p-marker-directory', kind: 'ensure-directory', mode: process.platform === 'win32' ? null : 493, target: '.claude' }
      const carried = inspection(root, { git: { ...inspection(root).git, electionRequired: true, kind: 'git', objectFormat: 'sha1', plansPolicy: 'satisfied' }, targets: [{ bom: null, cleanTextSha256: null, contentBase64: null, contentRole: 'none', editableRegions: [], finalNewline: null, kind: 'directory', mode: action.mode, newline: null, rawSha256: null, states: ['missing'], target: action.target, templateId: null, templateSha256: null }], proposals: [{ action, afterBase64: null, beforeBase64: null, condition: 'always', proposalId: action.id, reason: 'missing-target' }] })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const writes = []
      const postWithMarker = inspection(root, { git: { ...carried.git, electionMarker: 'track', electionMarkerMode: process.platform === 'win32' ? null : 384, electionMarkerSnapshotId: carried.snapshotId }, targets: [{ ...carried.targets[0], states: ['present'] }] })
      const postWithoutMarker = inspection(root, { git: { ...carried.git, electionMarker: 'absent', electionMarkerMode: null, electionMarkerSnapshotId: null }, targets: [{ ...carried.targets[0], states: ['present'] }] })
      let postCollections = 0
      const result = publishApply(request(root, { actions: [action], inspection: carried, proposalDispositions: [{ disposition: 'selected', proposalId: action.id }], versionControlChoice: 'track' }), { currentInspection: carried, collectInspection: () => { postCollections += 1; return postCollections === 1 ? postWithMarker : postWithoutMarker }, writeSpy: (path) => { writes.push(path.replaceAll('\\', '/').replace(`${root}/`, '')) } })

      const markerIndex = writes.findIndex((path) => path.endsWith('/' + ELECTION_MARKER_PATH))
      const directoryIndex = writes.findIndex((path) => path.endsWith('/.claude'))
      assert.ok(markerIndex >= 0 && markerIndex < directoryIndex, writes.join(','))
      assert.equal(existsSync(join(root, ELECTION_MARKER_PATH)), false)
      assert.equal(postCollections, 2)
      assert.equal(result.postInspect.git.electionMarker, 'absent')
      assert.deepEqual(result.incompleteTargets, [])
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('rejects replacement when the approved prior target changes during staging', () => {
    const root = fixtureRoot()
    try {
      const before = Buffer.from('before\n', 'utf8')
      const after = Buffer.from('after\n', 'utf8')
      const external = Buffer.from('external\n', 'utf8')
      const action = { afterBase64: after.toString('base64'), beforeBase64: before.toString('base64'), id: 'p-replacement-drift', kind: 'exact-edit', regionId: 'features.document-preamble', target: 'FEATURES.md' }
      writeFileSync(join(root, 'FEATURES.md'), before)
      const carried = inspection(root, { ready: analyzeCatalog([{ contents: before.toString('utf8'), target: 'FEATURES.md' }]), targets: [{ bom: null, cleanTextSha256: null, contentBase64: before.toString('base64'), contentRole: 'semantic', editableRegions: [{ endByte: before.length, regionId: 'features.document-preamble', startByte: 0 }], finalNewline: true, kind: 'file', mode: process.platform === 'win32' ? null : 420, newline: 'lf', rawSha256: sha256(before), states: ['present'], target: 'FEATURES.md', templateId: null, templateSha256: null }], proposals: [{ action, afterBase64: action.afterBase64, beforeBase64: action.beforeBase64, condition: 'always', proposalId: action.id, reason: 'guidance-section' }] })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const applyRequest = request(root, { actions: [action], inspection: carried, proposalDispositions: [{ disposition: 'selected', proposalId: action.id }] })

      expectCode(() => publishApply(applyRequest, { currentInspection: carried, onTransition: (point) => { if (point === 'after-mode-assignment') writeFileSync(join(root, 'FEATURES.md'), external) }, rescanRegions: () => [{ endByte: after.length, regionId: 'features.document-preamble', startByte: 0 }] }), 'filesystem')
      assert.deepEqual(readFileSync(join(root, 'FEATURES.md')), external)
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('rejects replacement when the approved prior target keeps bytes but changes identity', () => {
    const root = fixtureRoot()
    try {
      const before = Buffer.from('before\n', 'utf8')
      const replacement = Buffer.from('replacement\n', 'utf8')
      const action = { afterBase64: replacement.toString('base64'), beforeBase64: before.toString('base64'), id: 'p-replacement-identity-drift', kind: 'exact-edit', regionId: 'features.document-preamble', target: 'FEATURES.md' }
      writeFileSync(join(root, 'FEATURES.md'), before)
      const carried = inspection(root, { ready: analyzeCatalog([{ contents: before.toString('utf8'), target: 'FEATURES.md' }]), targets: [{ bom: null, cleanTextSha256: null, contentBase64: before.toString('base64'), contentRole: 'semantic', editableRegions: [{ endByte: before.length, regionId: 'features.document-preamble', startByte: 0 }], finalNewline: true, kind: 'file', mode: process.platform === 'win32' ? null : 420, newline: 'lf', rawSha256: sha256(before), states: ['present'], target: action.target, templateId: null, templateSha256: null }], proposals: [{ action, afterBase64: action.afterBase64, beforeBase64: action.beforeBase64, condition: 'always', proposalId: action.id, reason: 'guidance-section' }] })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const applyRequest = request(root, { actions: [action], inspection: carried, proposalDispositions: [{ disposition: 'selected', proposalId: action.id }] })

      assert.throws(() => publishApply(applyRequest, { currentInspection: carried, onTransition: (point) => { if (point === 'after-lock-upgrade') { rmSync(join(root, 'FEATURES.md')); writeFileSync(join(root, 'FEATURES.md'), before) } } }))
      assert.deepEqual(readFileSync(join(root, 'FEATURES.md')), before)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('adopts an inventoried bootstrap stage after lock upgrade before stage cleanup', () => {
    const root = fixtureRoot()
    const ownerNonce = 'a'.repeat(32)
    const pid = process.pid
    try {
      const carried = inspection(root)
      const applyRequest = request(root, { inspection: carried })
      const manifestId = admitApplyManifest(applyRequest).manifestId
      const paths = temporaryPaths(root, manifestId, 1, ownerNonce, carried.snapshotId, pid)
      let bootstrapWritten = false
      assert.throws(() => publishApply(applyRequest, { currentInspection: carried, ownerNonce, pid, onTransition: (point) => {
        if (point === 'after-lock-upgrade' && !bootstrapWritten) {
          const record = { createdAtUnixMs: 0, manifestId: null, operation: 'apply', ownerNonce, pid, protocolVersion: 1, recoveryId: null, root, temporaryPaths: [relative(root, paths.lockNext).replaceAll('\\', '/'), relative(root, paths.lockStage).replaceAll('\\', '/')].sort(), unfinalizedDirectories: [] }
          writeFileSync(paths.lockStage, Buffer.from(`${canonicalJson(record)}\n`, 'utf8'), { mode: 0o600 })
          bootstrapWritten = true
          throw new Error('crash after upgraded lock before bootstrap cleanup')
        }
      } }))
      assert.equal(existsSync(paths.lockStage), true)
      assert.equal(existsSync(paths.lock), true)
      const result = publishApply(applyRequest, { collectInspection: () => carried, currentInspection: carried, ownerNonce, pid, resume: true })

      assert.equal(result.ok, true)
      assert.equal(existsSync(paths.lockStage), false)
      assert.equal(existsSync(paths.lock), false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('adopts a staged lock upgrade with stable bytes after response loss', () => {
    const root = fixtureRoot()
    const ownerNonce = 'b'.repeat(32)
    const pid = process.pid
    try {
      const carried = inspection(root)
      const applyRequest = request(root, { inspection: carried })
      const paths = temporaryPaths(root, 'a'.repeat(64), 1, ownerNonce, carried.snapshotId, pid)
      let stageWrites = 0
      assert.throws(() => publishApply(applyRequest, { currentInspection: carried, ownerNonce, pid, crash: true, onTransition: (point) => {
        if (point === 'after-owner-stage-write') {
          stageWrites += 1
          if (stageWrites === 2) throw new Error('crash after lock upgrade staging')
        }
      } }), /crash after lock upgrade staging/)
      assert.equal(existsSync(paths.lockNext), true)
      assert.equal(existsSync(paths.lock), true)
      const result = publishApply(applyRequest, { collectInspection: () => carried, currentInspection: carried, ownerNonce, pid, resume: true })

      assert.equal(result.ok, true)
      assert.equal(existsSync(paths.lockNext), false)
      assert.equal(existsSync(paths.lock), false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('adopts an exact published target and temporary hard-link response-loss prefix', () => {
    const root = fixtureRoot()
    const ownerNonce = 'c'.repeat(32)
    try {
      const bytes = Buffer.from('approved\n', 'utf8')
      const action = { id: 'p-hard-link-response-loss', kind: 'create-from-template', mode: process.platform === 'win32' ? null : 420, newline: 'lf', target: 'FEATURES.md', templateId: 'backlog.features' }
      const carried = inspection(root, { ready: analyzeCatalog([{ contents: 'approved\n', target: 'FEATURES.md' }]), targets: [{ bom: null, cleanTextSha256: null, contentBase64: null, contentRole: 'semantic', editableRegions: [], finalNewline: null, kind: 'file', mode: action.mode, newline: null, rawSha256: null, states: ['missing'], target: action.target, templateId: action.templateId, templateSha256: 'a'.repeat(64) }], proposals: [{ action, afterBase64: bytes.toString('base64'), beforeBase64: null, condition: 'always', proposalId: action.id, reason: 'missing-target' }], templates: [{ conceptIds: [], logicalSha256: 'a'.repeat(64), target: action.target, templateId: action.templateId }] })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const applyRequest = request(root, { actions: [action], inspection: carried, proposalDispositions: [{ disposition: 'selected', proposalId: action.id }], semanticDecisions: [{ conceptIds: [], status: 'satisfied', target: action.target }] })
      const paths = temporaryPaths(root, admitApplyManifest(applyRequest).manifestId, 1, ownerNonce, carried.snapshotId)
      assert.throws(() => publishApply(applyRequest, { currentInspection: carried, ownerNonce, onPublished: (destination) => { if (destination.endsWith('FEATURES.md')) throw new Error('response lost after target publication') } }))
      assert.equal(existsSync(paths.action), true)
      assert.equal(existsSync(join(root, 'FEATURES.md')), true)
      const live = inspection(root, { ready: carried.ready, targets: [{ ...carried.targets[0], contentBase64: bytes.toString('base64'), rawSha256: sha256(bytes), states: ['present'] }], proposals: carried.proposals, templates: carried.templates })
      const result = publishApply(applyRequest, { collectInspection: () => live, ownerNonce, resume: true })

      assert.equal(result.ok, true)
      assert.equal(existsSync(paths.action), false)
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('adopts an exact fresh marker and temporary hard-link response-loss prefix', () => {
    const root = fixtureRoot()
    const ownerNonce = 'd'.repeat(32)
    try {
      const carried = inspection(root, { git: { ...inspection(root).git, electionRequired: true, kind: 'git', objectFormat: 'sha1', plansPolicy: 'satisfied' } })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const applyRequest = request(root, { inspection: carried, versionControlChoice: 'track' })
      const manifestId = admitApplyManifest(applyRequest).manifestId
      const paths = temporaryPaths(root, manifestId, 1, ownerNonce, carried.snapshotId)
      let collections = 0
      const collect = () => {
        collections += 1
        const present = existsSync(join(root, ELECTION_MARKER_PATH))

        return collections === 1 ? carried : inspection(root, { git: { ...carried.git, electionMarker: present ? 'track' : 'absent', electionMarkerMode: present && process.platform !== 'win32' ? 384 : null, electionMarkerSnapshotId: present ? carried.snapshotId : null } })
      }
      assert.throws(() => publishApply(applyRequest, { collectInspection: collect, crash: true, ownerNonce, onPublished: (destination) => { if (destination.endsWith(ELECTION_MARKER_PATH)) throw new Error('response lost after marker publication') } }))
      assert.equal(existsSync(paths.electionNewWitness), true)
      assert.equal(existsSync(join(root, ELECTION_MARKER_PATH)), true)
      const result = publishApply(applyRequest, { collectInspection: collect, ownerNonce, resume: true })

      assert.equal(result.ok, true)
      assert.equal(existsSync(paths.electionNewWitness), false)
      assert.equal(existsSync(join(root, ELECTION_MARKER_PATH)), false)
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('retains a successor marker when fresh marker response-loss cleanup changes identity', () => {
    const root = fixtureRoot()
    const ownerNonce = 'e'.repeat(32)
    try {
      const carried = inspection(root, { git: { ...inspection(root).git, electionRequired: true, kind: 'git', objectFormat: 'sha1', plansPolicy: 'satisfied' } })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const applyRequest = request(root, { inspection: carried, versionControlChoice: 'track' })
      const manifestId = admitApplyManifest(applyRequest).manifestId
      const paths = temporaryPaths(root, manifestId, 1, ownerNonce, carried.snapshotId)
      let collectionCount = 0
      const markerPath = join(root, ELECTION_MARKER_PATH)
      const collect = () => {
        collectionCount += 1
        const present = existsSync(markerPath)
        const live = inspection(root, { git: { ...carried.git, electionMarker: present ? 'track' : 'absent', electionMarkerMode: present && process.platform !== 'win32' ? 384 : null, electionMarkerSnapshotId: present ? carried.snapshotId : null } })
        if (collectionCount === 3 && present) {
          const bytes = readFileSync(markerPath)
          rmSync(markerPath)
          writeFileSync(markerPath, bytes, { mode: 0o600 })
        }

        return collectionCount === 1 ? carried : live
      }

      assert.throws(() => publishApply(applyRequest, { collectInspection: collect, crash: true, ownerNonce, onPublished: (destination) => { if (destination.endsWith(ELECTION_MARKER_PATH)) throw new Error('response lost after fresh marker publication') } }), /response lost after fresh marker publication/)
      assert.throws(() => publishApply(applyRequest, { collectInspection: collect, ownerNonce, preserveLockOnError: true, resume: true }), /Published target shares an unexpected temporary identity/)
      assert.equal(existsSync(markerPath), true)
      assert.equal(existsSync(paths.electionNewWitness), true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('resumes terminal marker removal after a crash between owned unlinks', () => {
    const root = fixtureRoot()
    const ownerNonce = 'f'.repeat(32)
    try {
      const carried = inspection(root, { git: { ...inspection(root).git, electionRequired: true, kind: 'git', objectFormat: 'sha1', plansPolicy: 'satisfied' } })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const applyRequest = request(root, { inspection: carried, versionControlChoice: 'track' })
      const manifestId = admitApplyManifest(applyRequest).manifestId
      const paths = temporaryPaths(root, manifestId, 1, ownerNonce, carried.snapshotId)
      let collectionCount = 0
      const markerPath = join(root, ELECTION_MARKER_PATH)
      const collect = () => {
        collectionCount += 1
        if (collectionCount === 1) return carried
        const present = existsSync(markerPath)

        return inspection(root, { git: { ...carried.git, electionMarker: present ? 'track' : 'absent', electionMarkerMode: present && process.platform !== 'win32' ? 384 : null, electionMarkerSnapshotId: present ? carried.snapshotId : null } })
      }

      assert.throws(() => publishApply(applyRequest, { collectInspection: collect, crash: true, ownerNonce, onPublished: (destination) => { if (destination.endsWith(ELECTION_MARKER_PATH)) throw new Error('response lost before marker cleanup') } }), /response lost before marker cleanup/)
      assert.throws(() => publishApply(applyRequest, { collectInspection: collect, ownerNonce, failAt: 'after-marker-unlink', resume: true }), /Injected publication failure at after-marker-unlink/)
      assert.equal(existsSync(markerPath), false)
      assert.equal(existsSync(paths.electionNewWitness), true)
      assert.equal(existsSync(paths.electionTombstone), true)
      const writes = []
      const result = publishApply(applyRequest, { collectInspection: collect, ownerNonce, resume: true, writeSpy: (path) => { writes.push(path) } })

      assert.equal(result.ok, true)
      assert.equal(existsSync(markerPath), false)
      assert.equal(existsSync(paths.electionNewWitness), false)
      assert.equal(writes.some((path) => path.endsWith(ELECTION_MARKER_PATH)), false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('retains a same-bytes successor lock when it changes during upgrade', () => {
    const root = fixtureRoot()
    try {
      const carried = inspection(root)
      let ownerStageWrites = 0
      assert.throws(() => publishApply(request(root), { currentInspection: carried, crash: true, preserveLockOnError: true, renameSync: (source, destination) => { rmSync(destination); renameSync(source, destination) }, onTransition: (point) => {
        if (point !== 'after-owner-stage-write') return
        ownerStageWrites += 1
        if (ownerStageWrites === 2) {
          const lockPath = join(root, '.nightshift-init-backlog.lock')
          const bytes = readFileSync(lockPath)
          rmSync(lockPath)
          writeFileSync(lockPath, bytes, { mode: 0o600 })
        }
      } }), /Publication lock changed before upgrade/)
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('retains a same-bytes successor lock when it changes during cleanup', () => {
    const root = fixtureRoot()
    try {
      const bytes = Buffer.from('approved\n', 'utf8')
      const action = { id: 'p-lock-cleanup-identity', kind: 'create-from-template', mode: process.platform === 'win32' ? null : 420, newline: 'lf', target: 'FEATURES.md', templateId: 'backlog.features' }
      const carried = inspection(root, { ready: analyzeCatalog([{ contents: 'approved\n', target: 'FEATURES.md' }]), targets: [{ bom: null, cleanTextSha256: null, contentBase64: null, contentRole: 'semantic', editableRegions: [], finalNewline: null, kind: 'file', mode: action.mode, newline: null, rawSha256: null, states: ['missing'], target: action.target, templateId: action.templateId, templateSha256: 'a'.repeat(64) }], proposals: [{ action, afterBase64: bytes.toString('base64'), beforeBase64: null, condition: 'always', proposalId: action.id, reason: 'missing-target' }], templates: [{ conceptIds: [], logicalSha256: 'a'.repeat(64), target: action.target, templateId: action.templateId }] })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const applyRequest = request(root, { actions: [action], inspection: carried, proposalDispositions: [{ disposition: 'selected', proposalId: action.id }], semanticDecisions: [{ conceptIds: [], status: 'satisfied', target: action.target }] })
      expectCode(() => publishApply(applyRequest, { collectInspection: () => carried, onTransition: (point) => {
        if (point !== 'after-final-verification') return
        const lockPath = join(root, '.nightshift-init-backlog.lock')
        const lockBytes = readFileSync(lockPath)
        rmSync(lockPath)
        writeFileSync(lockPath, lockBytes, { mode: 0o600 })
      } }), 'cleanup-failed')
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('classifies every same-target chain boundary as one approved prefix', () => {
    const root = fixtureRoot()
    try {
      const target = '.claude/FEATURES.md'
      const before = Buffer.from('# Features\n', 'utf8')
      const middle = Buffer.from('# Features\nexpanded\n', 'utf8')
      const after = Buffer.from('# Features\nexpanded\nfinal\n', 'utf8')
      const first = { afterBase64: middle.toString('base64'), beforeBase64: before.toString('base64'), id: 'p-chain-progress-first', kind: 'exact-edit', regionId: 'features.document-preamble', target }
      const second = { afterBase64: after.toString('base64'), beforeBase64: middle.toString('base64'), id: 'p-chain-progress-second', kind: 'exact-edit', regionId: 'features.next-region', target }
      const applyRequest = { actions: [first, second], inspection: { proposals: [] } }
      mkdirSync(join(root, '.claude'), { recursive: true })
      let opens = 0

      const boundaries = [before, middle, after].map((bytes) => {
        writeFileSync(join(root, target), bytes)

        return approvedProgress(applyRequest, root, { stableOpenFile: (...args) => { opens += 1; return stableOpenFile(...args) } })
      })

      assert.deepEqual(boundaries, [
        { applied: 0, recognized: true },
        { applied: 1, recognized: true },
        { applied: 2, recognized: true },
      ])
      assert.equal(opens, boundaries.length)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('classifies an unwrap and semantic chain from one target snapshot', () => {
    const root = fixtureRoot()
    try {
      const target = '.claude/FEATURES.md'
      const before = Buffer.from('# Features\n\nA paragraph split across\ntwo physical lines for repair.\n', 'utf8')
      const middle = Buffer.from(unwrapText(before.toString('utf8')), 'utf8')
      const after = Buffer.from(`${middle.toString('utf8')}final\n`, 'utf8')
      const first = { afterRawSha256: sha256(middle), beforeRawSha256: sha256(before), id: 'p-chain-unwrap-first', kind: 'unwrap-file', mode: process.platform === 'win32' ? null : 420, target }
      const second = { afterBase64: after.toString('base64'), beforeBase64: middle.toString('base64'), id: 'p-chain-unwrap-second', kind: 'exact-edit', regionId: 'features.document-preamble', target }
      const applyRequest = { actions: [first, second], inspection: { proposals: [], wrapFindings: [{ beforeRawSha256: first.beforeRawSha256, predictedContentBase64: null, predictedRawSha256: first.afterRawSha256, target }] } }
      mkdirSync(join(root, '.claude'), { recursive: true })
      let opens = 0

      const boundaries = [before, middle, after].map((bytes) => {
        writeFileSync(join(root, target), bytes)

        return approvedProgress(applyRequest, root, { stableOpenFile: (...args) => { opens += 1; return stableOpenFile(...args) } })
      })

      assert.deepEqual(boundaries, [
        { applied: 0, recognized: true },
        { applied: 1, recognized: true },
        { applied: 2, recognized: true },
      ])
      assert.equal(opens, boundaries.length)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('recognizes a complete same-target chain without replaying its first intermediate', () => {
    const root = fixtureRoot()
    try {
      const before = Buffer.from('# Features\n', 'utf8')
      const middle = Buffer.from('# Features\nexpanded\n', 'utf8')
      const after = Buffer.from('# Features\nexpanded\nfinal\n', 'utf8')
      mkdirSync(join(root, '.claude'), { recursive: true })
      writeFileSync(join(root, '.claude/FEATURES.md'), after)
      const first = { afterBase64: middle.toString('base64'), beforeBase64: before.toString('base64'), id: 'p-chain-first', kind: 'exact-edit', regionId: 'features.document-preamble', target: '.claude/FEATURES.md' }
      const second = { afterBase64: after.toString('base64'), beforeBase64: middle.toString('base64'), id: 'p-chain-second', kind: 'exact-edit', regionId: 'features.next-region', target: '.claude/FEATURES.md' }
      const carried = inspection(root, { ready: analyzeCatalog([{ contents: after.toString('utf8'), target: 'FEATURES.md' }]), targets: [{ bom: null, cleanTextSha256: null, contentBase64: before.toString('base64'), contentRole: 'semantic', editableRegions: [{ endByte: before.length, regionId: 'features.document-preamble', startByte: 0 }], finalNewline: true, kind: 'file', mode: process.platform === 'win32' ? null : 420, newline: 'lf', rawSha256: 'b'.repeat(64), states: ['present'], target: '.claude/FEATURES.md', templateId: null, templateSha256: null }], proposals: [first, second].map((item) => ({ action: item, afterBase64: item.afterBase64, beforeBase64: item.beforeBase64, condition: 'always', proposalId: item.id, reason: 'guidance-section' })) })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const result = publishApply(request(root, { actions: [first, second], inspection: carried, proposalDispositions: [{ disposition: 'selected', proposalId: first.id }, { disposition: 'selected', proposalId: second.id }] }), { collectInspection: () => carried, rescanRegions: ({ action }) => [{ endByte: action.id === first.id ? middle.length : after.length, regionId: action.id === first.id ? 'features.next-region' : 'features.final-region', startByte: 0 }] })

      assert.deepEqual(result.outcomes.map((item) => item.status), ['skipped-complete', 'skipped-complete'])
      assert.deepEqual(readFileSync(join(root, '.claude/FEATURES.md')), after)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('buffers each same-target publication action at most once', (context) => {
    const root = fixtureRoot()
    context.after(() => rmSync(root, { force: true, recursive: true }))
    const target = '.claude/FEATURES.md'
    const actionCount = 64
    const images = [Buffer.from('# Features\n', 'utf8')]
    for (let index = 0; index < actionCount; index += 1) images.push(Buffer.from(`${images[index].toString('utf8')}line ${index}\n`, 'utf8'))
    const actions = Array.from({ length: actionCount }, (_, index) => ({ afterBase64: images[index + 1].toString('base64'), beforeBase64: images[index].toString('base64'), id: `p-linear-chain-${index}`, kind: 'exact-edit', regionId: 'features.document-preamble', target }))
    const carried = inspection(root, {
      proposals: actions.map((action) => ({ action, afterBase64: action.afterBase64, beforeBase64: action.beforeBase64, condition: 'always', proposalId: action.id, reason: 'guidance-section' })),
      ready: analyzeCatalog([{ contents: images[actionCount].toString('utf8'), target: 'FEATURES.md' }]),
      targets: [{ bom: null, cleanTextSha256: null, contentBase64: images[0].toString('base64'), contentRole: 'semantic', editableRegions: [{ endByte: images[0].length, regionId: 'features.document-preamble', startByte: 0 }], finalNewline: true, kind: 'file', mode: process.platform === 'win32' ? null : 420, newline: 'lf', rawSha256: sha256(images[0]), states: ['present'], target, templateId: null, templateSha256: null }],
    })
    carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
    const applyRequest = request(root, { actions, inspection: carried, proposalDispositions: actions.map((action) => ({ disposition: 'selected', proposalId: action.id })) })
    mkdirSync(join(root, '.claude'), { recursive: true })
    writeFileSync(join(root, target), images[0])
    const originalPush = Array.prototype.push
    let countActionBuffering = false
    let bufferedActions = 0
    try {
      Array.prototype.push = function (...items) {
        if (countActionBuffering) bufferedActions += items.filter((item) => item?.kind === 'exact-edit' && item.target === target).length

        return Reflect.apply(originalPush, this, items)
      }
      const result = publishApply(applyRequest, {
        collectInspection: () => carried,
        onTransition: (point) => { if (point === 'after-lock-upgrade') countActionBuffering = true },
        rescanRegions: ({ action }) => [{ endByte: Buffer.from(action.afterBase64, 'base64').length, regionId: action.regionId, startByte: 0 }],
      })

      assert.equal(result.outcomes.length, actionCount)
    } finally {
      Array.prototype.push = originalPush
    }
    assert.ok(bufferedActions <= actionCount, `same-target planning buffered ${bufferedActions} actions for a ${actionCount}-action chain`)
    assert.deepEqual(readFileSync(join(root, target)), images[actionCount])
  })

  test('rejects an untrusted resumed lock before any publication', () => {
    const root = fixtureRoot()
    try {
      writeFileSync(join(root, '.nightshift-init-backlog.lock'), Buffer.from('{"ownerNonce":"not-a-nonce"}\n', 'utf8'))

      expectCode(() => publishApply(request(root), { currentInspection: inspection(root), resume: true }), 'runtime-lock')
      assert.equal(readFileSync(join(root, '.nightshift-init-backlog.lock'), 'utf8'), '{"ownerNonce":"not-a-nonce"}\n')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('rejects an existing publication lock with an unsafe POSIX mode', () => {
    const root = fixtureRoot()
    const ownerNonce = 'c'.repeat(32)
    const pid = process.pid
    try {
      const paths = temporaryPaths(root, 'a'.repeat(64), 1, ownerNonce, 'b'.repeat(64), pid)
      const record = { createdAtUnixMs: 0, manifestId: null, operation: 'apply', ownerNonce, pid, protocolVersion: 1, recoveryId: null, root, temporaryPaths: [relative(root, paths.lockNext).replaceAll('\\', '/'), relative(root, paths.lockStage).replaceAll('\\', '/')].sort(), unfinalizedDirectories: [] }
      createInitialLock(root, record, { ownerNonce, pid })
      if (process.platform !== 'win32') chmodSync(join(root, '.nightshift-init-backlog.lock'), 0o644)
      let writes = 0

      if (process.platform !== 'win32') {
        expectCode(() => publishApply(request(root), { currentInspection: inspection(root), ownerNonce, pid, platform: 'posix', resume: true, writeSpy: () => { writes += 1 } }), 'runtime-lock')
        assert.equal(writes, 0)
        assert.equal(statSync(join(root, '.nightshift-init-backlog.lock')).mode & 0o777, 0o644)
      } else {
        const result = publishApply(request(root), { collectInspection: () => inspection(root), currentInspection: inspection(root), ownerNonce, pid, platform: 'win32', resume: true })
        assert.equal(result.ok, true)
        assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), false)
      }
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('existing publication lock reads stop at the recovery-request ceiling', () => {
    for (const extraBytes of [0, 1]) {
      const root = fixtureRoot()
      try {
        writeFileSync(join(root, '.nightshift-init-backlog.lock'), Buffer.alloc(MAX_RECOVERY_REQUEST_BYTES + extraBytes, 0x61), { mode: 0o600 })

        assert.throws(
          () => publishApply(request(root), { currentInspection: inspection(root), resume: true }),
          (error) => error.record?.code === 'runtime-lock' && (extraBytes === 0 ? error.cause?.code !== 'file-too-large' : error.cause?.code === 'file-too-large'),
        )
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    }
  })

  test('renamed publication readback stops at the expected byte length', () => {
    for (const extraBytes of [0, 1]) {
      const root = fixtureRoot()
      try {
        const path = join(root, 'FEATURES.md')
        const before = Buffer.from('before\n', 'utf8')
        const desired = Buffer.from('desired\n', 'utf8')
        writeFileSync(path, before, { mode: 0o644 })
        const expected = stableOpenFile(root, path, { requireSingleLink: true })

        assert.throws(
          () => publishRecoveryFile(root, path, desired, expected.mode, {
            expected,
            recoveryId: 'a'.repeat(64),
            renameSync: (source, destination) => {
              renameSync(source, destination)
              writeFileSync(destination, Buffer.alloc(desired.length + extraBytes, 0x61), { mode: 0o644 })
            },
          }),
          (error) => extraBytes === 0 ? error.code !== 'file-too-large' : error.code === 'file-too-large',
        )
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    }
  })

  test('keeps the published bootstrap lock and stage on an abrupt owner-publication crash', () => {
    const root = fixtureRoot()
    try {
      assert.throws(() => publishApply(request(root), { currentInspection: inspection(root), crash: true, crashAfterOwnerPublish: true, onPublished: () => { throw new Error('abrupt owner publication') } }), /abrupt owner publication/)
      const names = readdirSync(root)

      assert.equal(names.includes('.nightshift-init-backlog.lock'), true, names.join(','))
      assert.equal(names.some((name) => name.endsWith('.new')), true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('keeps an orphan bootstrap stage on an abrupt pre-hard-link termination', () => {
    const root = fixtureRoot()
    try {
      assert.throws(() => publishApply(request(root), { currentInspection: inspection(root), crash: true, crashBeforeOwnerPublish: true, failAt: 'after-owner-stage-write' }), /Injected publication failure at after-owner-stage-write/)
      const names = readdirSync(root)

      assert.equal(names.includes('.nightshift-init-backlog.lock'), false)
      assert.equal(names.some((name) => name.endsWith('.new')), true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('acquires the bootstrap lock before live inspection and admission', () => {
    const root = fixtureRoot()
    try {
      let observed = false
      let collectionCount = 0
      const result = publishApply(request(root), { collectInspection: () => { collectionCount += 1; if (collectionCount === 1) observed = existsSync(join(root, '.nightshift-init-backlog.lock')); return inspection(root) } })

      assert.equal(result.ok, true)
      assert.equal(observed, true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('resumes a bootstrap lock with its unchanged owner stage and cleans that stage', () => {
    const root = fixtureRoot()
    try {
      const applyRequest = request(root)
      assert.throws(() => publishApply(applyRequest, { currentInspection: inspection(root), crash: true, crashAfterOwnerPublish: true, onPublished: () => { throw new Error('abrupt owner publication') } }), /abrupt owner publication/)

      const result = publishApply(applyRequest, { collectInspection: () => inspection(root), resume: true })

      assert.equal(result.ok, true)
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), false)
      assert.equal(readdirSync(root).some((name) => name.endsWith('.new')), false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('does not adopt marker temporaries created before bootstrap upgrade', () => {
    for (const temporaryKey of ['electionAlias', 'electionTombstone']) {
      const root = fixtureRoot()
      const ownerNonce = '1'.repeat(32)
      const pid = process.pid
      try {
        const carried = inspection(root, { git: { ...inspection(root).git, electionRequired: true, kind: 'git', objectFormat: 'sha1', plansPolicy: 'satisfied' } })
        carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
        const applyRequest = request(root, { inspection: carried, versionControlChoice: 'track' })
        const manifestId = admitApplyManifest(applyRequest).manifestId
        const paths = temporaryPaths(root, manifestId, 1, ownerNonce, carried.snapshotId, pid)
        const bootstrapPaths = temporaryPaths(root, manifestId, 1, ownerNonce, carried.snapshotId, pid)
        const bootstrapRecord = { createdAtUnixMs: 0, manifestId: null, operation: 'apply', ownerNonce, pid, protocolVersion: 1, recoveryId: null, root, temporaryPaths: [relative(root, bootstrapPaths.lockNext).replaceAll('\\', '/'), relative(root, bootstrapPaths.lockStage).replaceAll('\\', '/')].sort(), unfinalizedDirectories: [] }
        createInitialLock(root, bootstrapRecord, { ownerNonce, pid })
        const marker = composeElectionMarker('track', 'git', true, carried.snapshotId, process.platform === 'win32' ? null : 384, root)
        const markerBytes = Buffer.from(marker.contentBase64, 'base64')
        writeFileSync(paths[temporaryKey], markerBytes, { mode: process.platform === 'win32' ? undefined : 0o600 })
        let writes = 0

        expectCode(() => publishApply(applyRequest, { currentInspection: carried, collectInspection: () => carried, ownerNonce, pid, resume: true, writeSpy: () => { writes += 1 } }), 'runtime-lock')
        assert.equal(writes, 0)
        assert.deepEqual(readFileSync(paths[temporaryKey]), markerBytes)
        assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), true)
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    }
  })

  test('adopts an exact marker temporary only after an upgraded owner authorizes it', () => {
    const root = fixtureRoot()
    const ownerNonce = '2'.repeat(32)
    const pid = process.pid
    try {
      const carried = inspection(root, { git: { ...inspection(root).git, electionRequired: true, kind: 'git', objectFormat: 'sha1', plansPolicy: 'satisfied' } })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const applyRequest = request(root, { inspection: carried, versionControlChoice: 'track' })
      const manifestId = admitApplyManifest(applyRequest).manifestId
      const paths = temporaryPaths(root, manifestId, 1, ownerNonce, carried.snapshotId, pid)
      const marker = composeElectionMarker('track', 'git', true, carried.snapshotId, process.platform === 'win32' ? null : 384, root)
      const markerBytes = Buffer.from(marker.contentBase64, 'base64')
      assert.throws(() => publishApply(applyRequest, { currentInspection: carried, collectInspection: () => carried, ownerNonce, pid, crash: true, onTransition: (point) => {
        if (point === 'after-lock-upgrade') {
          writeFileSync(paths.electionAlias, markerBytes, { mode: process.platform === 'win32' ? undefined : 0o600 })
          throw new Error('crash after upgraded owner authorization')
        }
      } }), /crash after upgraded owner authorization/)
      assert.equal(existsSync(paths.electionAlias), true)
      const result = publishApply(applyRequest, { currentInspection: carried, collectInspection: () => carried, ownerNonce, pid, resume: true })

      assert.equal(result.ok, true)
      assert.equal(existsSync(paths.electionAlias), false)
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('replays replacement terminal cleanup only from owned terminal evidence', () => {
    for (const failAt of ['after-marker-terminal-rename', 'after-marker-witness-removal']) {
      const root = fixtureRoot()
      const ownerNonce = failAt === 'after-marker-terminal-rename' ? '3'.repeat(32) : '4'.repeat(32)
      try {
        const carried = inspection(root, { git: { ...inspection(root).git, electionMarker: 'deferred', electionMarkerMode: process.platform === 'win32' ? null : 416, electionMarkerSnapshotId: 'a'.repeat(64), electionRequired: true, kind: 'git', objectFormat: 'sha1', plansPolicy: 'satisfied' } })
        carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
        const oldMarker = composeElectionMarker('deferred', 'git', true, carried.git.electionMarkerSnapshotId, carried.git.electionMarkerMode, root)
        writeFileSync(join(root, ELECTION_MARKER_PATH), Buffer.from(oldMarker.contentBase64, 'base64'), { mode: carried.git.electionMarkerMode ?? 0o600 })
        const applyRequest = request(root, { inspection: carried, versionControlChoice: 'track' })
        const manifestId = admitApplyManifest(applyRequest).manifestId
        const paths = temporaryPaths(root, manifestId, 1, ownerNonce, carried.snapshotId)
        const markerPath = join(root, ELECTION_MARKER_PATH)
        const collect = () => {
          const present = existsSync(markerPath)

          return inspection(root, { git: { ...carried.git, electionMarker: present ? 'track' : 'absent', electionMarkerMode: present && process.platform !== 'win32' ? carried.git.electionMarkerMode : null, electionMarkerSnapshotId: present ? carried.snapshotId : null } })
        }
        assert.throws(() => publishApply(applyRequest, { currentInspection: carried, collectInspection: collect, crash: true, ownerNonce, failAt }), new RegExp(`Injected publication failure at ${failAt}`))
        assert.equal(existsSync(join(root, ELECTION_MARKER_PATH)), false)
        assert.equal(existsSync(paths.electionTombstone), true, readdirSync(root).join(','))
        const result = publishApply(applyRequest, { collectInspection: collect, ownerNonce, resume: true })

        assert.equal(result.ok, true)
        assert.equal(existsSync(join(root, ELECTION_MARKER_PATH)), false)
        assert.equal(existsSync(paths.electionTombstone), false)
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    }
  })

  test('rejects an extra hard link on a bootstrap stage before cleanup on Windows semantics', () => {
    const root = fixtureRoot()
    const external = join(root, 'external-stage-link')
    try {
      const applyRequest = request(root)
      assert.throws(() => publishApply(applyRequest, { currentInspection: inspection(root), crash: true, crashAfterOwnerPublish: true, onPublished: () => { throw new Error('abrupt owner publication') }, platform: 'win32' }), /abrupt owner publication/)
      const stage = readdirSync(root).map((name) => join(root, name)).find((path) => path.endsWith('.new'))
      assert.ok(stage)
      expectCode(() => publishApply(applyRequest, { currentInspection: inspection(root), platform: 'win32', resume: true, onTransition: (point) => { if (point === 'after-lock-upgrade') linkSync(stage, external) } }), 'cleanup-failed')
      assert.equal(existsSync(stage), true)
      assert.equal(existsSync(external), true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('rejects mechanical unwrap input mutation using its approved raw digest', () => {
    const root = fixtureRoot()
    try {
      const wrapped = Buffer.from('line one\nline two\n', 'utf8')
      const mutated = Buffer.from('line one\nchanged\n', 'utf8')
      const action = { afterRawSha256: sha256(Buffer.from('line one\nline two\n', 'utf8')), beforeRawSha256: sha256(wrapped), id: 'p-mechanical-unwrap', kind: 'unwrap-file', mode: process.platform === 'win32' ? null : 420, target: '.gitignore' }
      writeFileSync(join(root, '.gitignore'), wrapped)
      const carried = inspection(root, { git: { ...inspection(root).git, kind: 'git', objectFormat: 'sha1', plansPolicy: 'satisfied' }, targets: [{ bom: null, cleanTextSha256: null, contentBase64: null, contentRole: 'mechanical', editableRegions: [], finalNewline: true, kind: 'file', mode: action.mode, newline: 'lf', rawSha256: action.beforeRawSha256, states: ['wrapped'], target: action.target, templateId: null, templateSha256: null }], proposals: [{ action, afterBase64: null, beforeBase64: null, condition: 'always', proposalId: action.id, reason: 'hard-wrap' }], wrapFindings: [{ beforeRawSha256: action.beforeRawSha256, predictedContentBase64: null, predictedEditableRegions: [], predictedRawSha256: action.afterRawSha256, target: action.target }] })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const applyRequest = request(root, { actions: [action], inspection: carried, proposalDispositions: [{ disposition: 'selected', proposalId: action.id }], semanticDecisions: [] })

      expectCode(() => publishApply(applyRequest, { currentInspection: carried, onTransition: (point) => { if (point === 'after-lock-upgrade') writeFileSync(join(root, '.gitignore'), mutated) } }), 'filesystem')
      assert.deepEqual(readFileSync(join(root, '.gitignore')), mutated)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('resumes fresh and replacement marker chains after terminal tombstone removal', () => {
    for (const carriedMarker of ['absent', 'deferred']) {
      const root = fixtureRoot()
      const ownerNonce = carriedMarker === 'absent' ? '5'.repeat(32) : '6'.repeat(32)
      try {
        const carried = inspection(root, { git: { ...inspection(root).git, electionMarker: carriedMarker, electionMarkerMode: carriedMarker === 'absent' ? null : process.platform === 'win32' ? null : 416, electionMarkerSnapshotId: carriedMarker === 'absent' ? null : 'a'.repeat(64), electionRequired: true, kind: 'git', objectFormat: 'sha1', plansPolicy: 'satisfied' } })
        carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
        if (carriedMarker !== 'absent') {
          const oldMarker = composeElectionMarker(carriedMarker, 'git', true, carried.git.electionMarkerSnapshotId, carried.git.electionMarkerMode, root)
          writeFileSync(join(root, ELECTION_MARKER_PATH), Buffer.from(oldMarker.contentBase64, 'base64'), { mode: carried.git.electionMarkerMode ?? 0o600 })
        }
        const applyRequest = request(root, { inspection: carried, versionControlChoice: 'track' })
        const markerPath = join(root, ELECTION_MARKER_PATH)
        const collect = () => {
          const present = existsSync(markerPath)

          return inspection(root, { git: { ...carried.git, electionMarker: present ? 'track' : 'absent', electionMarkerMode: present && process.platform !== 'win32' ? 384 : null, electionMarkerSnapshotId: present ? carried.snapshotId : null } })
        }
        assert.throws(() => publishApply(applyRequest, { currentInspection: carried, collectInspection: collect, crash: true, ownerNonce, failAt: 'after-marker-tombstone-removal' }), /Injected publication failure at after-marker-tombstone-removal/)
        const paths = temporaryPaths(root, admitApplyManifest(applyRequest).manifestId, 1, ownerNonce, carried.snapshotId)
        assert.equal(existsSync(markerPath), false)
        assert.equal(existsSync(paths.electionAlias), false)
        assert.equal(existsSync(paths.electionNewWitness), false)
        assert.equal(existsSync(paths.electionTombstone), false)
        const writes = []
        const result = publishApply(applyRequest, { collectInspection: collect, linkSync: (source, destination) => { if (source.includes(ELECTION_MARKER_PATH) || destination.includes(ELECTION_MARKER_PATH)) writes.push(`link:${source}:${destination}`); return linkSync(source, destination) }, ownerNonce, renameSync: (source, destination) => { if (source.includes(ELECTION_MARKER_PATH) || destination.includes(ELECTION_MARKER_PATH)) writes.push(`rename:${source}:${destination}`); return renameSync(source, destination) }, resume: true, unlinkSync: (path) => { if (path.includes(ELECTION_MARKER_PATH)) writes.push(`unlink:${path}`); return unlinkSync(path) }, writeSpy: (path) => { if (path.includes(ELECTION_MARKER_PATH)) writes.push(`write:${path}`) } })

        assert.equal(result.ok, true)
        assert.equal(existsSync(markerPath), false)
        assert.deepEqual(writes, [])
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    }
  })

  test('resumes replacement from the upgraded lock before marker staging', () => {
    const root = fixtureRoot()
    const ownerNonce = '7'.repeat(32)
    try {
      const carried = inspection(root, { git: { ...inspection(root).git, electionMarker: 'deferred', electionMarkerMode: process.platform === 'win32' ? null : 416, electionMarkerSnapshotId: 'a'.repeat(64), electionRequired: true, kind: 'git', objectFormat: 'sha1', plansPolicy: 'satisfied' } })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const oldMarker = composeElectionMarker('deferred', 'git', true, carried.git.electionMarkerSnapshotId, carried.git.electionMarkerMode, root)
      const markerPath = join(root, ELECTION_MARKER_PATH)
      writeFileSync(markerPath, Buffer.from(oldMarker.contentBase64, 'base64'), { mode: carried.git.electionMarkerMode ?? 0o600 })
      const applyRequest = request(root, { inspection: carried, versionControlChoice: 'track' })

      assert.throws(() => publishApply(applyRequest, { currentInspection: carried, collectInspection: () => carried, crash: true, ownerNonce, failAt: 'after-lock-upgrade' }), /Injected publication failure at after-lock-upgrade/)
      const result = publishApply(applyRequest, { currentInspection: carried, collectInspection: () => carried, ownerNonce, resume: true })

      assert.equal(result.ok, true)
      assert.equal(existsSync(markerPath), false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('updates same-target publication identity across an edit chain', () => {
    const root = fixtureRoot()
    try {
      const before = Buffer.from('before\n', 'utf8')
      const middle = Buffer.from('middle\n', 'utf8')
      const after = Buffer.from('after\n', 'utf8')
      const first = { afterBase64: middle.toString('base64'), beforeBase64: before.toString('base64'), id: 'p-chain-first-r9', kind: 'exact-edit', regionId: 'features.document-preamble', target: 'FEATURES.md' }
      const second = { afterBase64: after.toString('base64'), beforeBase64: middle.toString('base64'), id: 'p-chain-second-r9', kind: 'exact-edit', regionId: 'features.next-region', target: 'FEATURES.md' }
      writeFileSync(join(root, 'FEATURES.md'), before)
      const carried = inspection(root, { targets: [{ bom: null, cleanTextSha256: null, contentBase64: before.toString('base64'), contentRole: 'semantic', editableRegions: [{ endByte: before.length, regionId: first.regionId }, { endByte: before.length, regionId: second.regionId }], finalNewline: true, kind: 'file', mode: process.platform === 'win32' ? null : 420, newline: 'lf', rawSha256: sha256(before), states: ['present'], target: 'FEATURES.md', templateId: null, templateSha256: null }], proposals: [first, second].map((action) => ({ action, afterBase64: action.afterBase64, beforeBase64: action.beforeBase64, condition: 'always', proposalId: action.id, reason: 'guidance-section' })) })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const applyRequest = request(root, { actions: [first, second], inspection: carried, proposalDispositions: [{ disposition: 'selected', proposalId: first.id }, { disposition: 'selected', proposalId: second.id }] })
      const result = publishApply(applyRequest, { currentInspection: carried, collectInspection: () => carried, rescanRegions: ({ action }) => [{ endByte: action.id === first.id ? middle.length : after.length, regionId: action.id === first.id ? second.regionId : 'features.final-region', startByte: 0 }] })

      assert.deepEqual(result.outcomes.map((item) => item.status), ['edited', 'edited'])
      assert.deepEqual(readFileSync(join(root, 'FEATURES.md')), after)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('rejects same-target chain publication after an inter-action inode mutation', () => {
    const root = fixtureRoot()
    try {
      const before = Buffer.from('before\n', 'utf8')
      const middle = Buffer.from('middle\n', 'utf8')
      const after = Buffer.from('after\n', 'utf8')
      const first = { afterBase64: middle.toString('base64'), beforeBase64: before.toString('base64'), id: 'p-chain-mutate-first-r9', kind: 'exact-edit', regionId: 'features.document-preamble', target: 'FEATURES.md' }
      const second = { afterBase64: after.toString('base64'), beforeBase64: middle.toString('base64'), id: 'p-chain-mutate-second-r9', kind: 'exact-edit', regionId: 'features.next-region', target: 'FEATURES.md' }
      writeFileSync(join(root, 'FEATURES.md'), before)
      const carried = inspection(root, { targets: [{ bom: null, cleanTextSha256: null, contentBase64: before.toString('base64'), contentRole: 'semantic', editableRegions: [{ endByte: before.length, regionId: first.regionId }, { endByte: before.length, regionId: second.regionId }], finalNewline: true, kind: 'file', mode: process.platform === 'win32' ? null : 420, newline: 'lf', rawSha256: sha256(before), states: ['present'], target: 'FEATURES.md', templateId: null, templateSha256: null }], proposals: [first, second].map((action) => ({ action, afterBase64: action.afterBase64, beforeBase64: action.beforeBase64, condition: 'always', proposalId: action.id, reason: 'guidance-section' })) })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const applyRequest = request(root, { actions: [first, second], inspection: carried, proposalDispositions: [{ disposition: 'selected', proposalId: first.id }, { disposition: 'selected', proposalId: second.id }] })
      let publications = 0

      expectCode(() => publishApply(applyRequest, { currentInspection: carried, collectInspection: () => carried, rescanRegions: ({ action }) => [{ endByte: action.id === first.id ? middle.length : after.length, regionId: action.id === first.id ? second.regionId : 'features.final-region', startByte: 0 }], onTransition: (point) => { if (point === 'after-final-verification') { publications += 1; if (publications === 1) { rmSync(join(root, 'FEATURES.md')); writeFileSync(join(root, 'FEATURES.md'), middle) } } } }), 'filesystem')
      assert.deepEqual(readFileSync(join(root, 'FEATURES.md')), middle)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('retains marker witnesses when an extra link appears after alias cleanup', () => {
    const root = fixtureRoot()
    const external = join(root, 'external-marker-witness-link')
    try {
      const carried = inspection(root, { git: { ...inspection(root).git, electionRequired: true, kind: 'git', objectFormat: 'sha1', plansPolicy: 'satisfied' } })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const applyRequest = request(root, { inspection: carried, versionControlChoice: 'track' })
      const manifestId = admitApplyManifest(applyRequest).manifestId
      const paths = temporaryPaths(root, manifestId, 1, '8'.repeat(32), carried.snapshotId)

      expectCode(() => publishApply(applyRequest, { currentInspection: carried, collectInspection: () => inspection(root, { git: { ...carried.git, electionMarker: 'track', electionMarkerMode: process.platform === 'win32' ? null : 384, electionMarkerSnapshotId: carried.snapshotId } }), ownerNonce: '8'.repeat(32), onTransition: (point) => { if (point === 'after-marker-alias-removal') linkSync(paths.electionNewWitness, external) } }), 'cleanup-failed')
      assert.equal(existsSync(paths.electionNewWitness), true)
      assert.equal(existsSync(external), true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('stops before marker publication when the lock changes after upgrade', () => {
    const root = fixtureRoot()
    try {
      const carried = inspection(root, { git: { ...inspection(root).git, electionRequired: true, kind: 'git', objectFormat: 'sha1', plansPolicy: 'satisfied' } })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const applyRequest = request(root, { inspection: carried, versionControlChoice: 'track' })
      const writes = []

      expectCode(() => publishApply(applyRequest, { currentInspection: carried, collectInspection: () => carried, onTransition: (point) => { if (point === 'after-lock-upgrade') { const lockPath = join(root, '.nightshift-init-backlog.lock'); const bytes = readFileSync(lockPath); rmSync(lockPath); writeFileSync(lockPath, bytes, { mode: 0o600 }) } }, writeSpy: (path) => { writes.push(path) } }), 'cleanup-failed')
      assert.equal(writes.some((path) => path.endsWith(ELECTION_MARKER_PATH)), false)
      assert.equal(existsSync(join(root, ELECTION_MARKER_PATH)), false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('stops before marker cleanup when the lock changes with a witness present', () => {
    const root = fixtureRoot()
    const ownerNonce = '9'.repeat(32)
    try {
      const carried = inspection(root, { git: { ...inspection(root).git, electionRequired: true, kind: 'git', objectFormat: 'sha1', plansPolicy: 'satisfied' } })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const applyRequest = request(root, { inspection: carried, versionControlChoice: 'track' })
      const markerPath = join(root, ELECTION_MARKER_PATH)
      const paths = temporaryPaths(root, admitApplyManifest(applyRequest).manifestId, 1, ownerNonce, carried.snapshotId)
      const collect = () => inspection(root, { git: { ...carried.git, electionMarker: existsSync(markerPath) ? 'track' : 'absent', electionMarkerMode: existsSync(markerPath) && process.platform !== 'win32' ? 384 : null, electionMarkerSnapshotId: existsSync(markerPath) ? carried.snapshotId : null } })
      expectCode(() => publishApply(applyRequest, { currentInspection: carried, collectInspection: collect, ownerNonce, onTransition: (point) => { if (point === 'after-marker-alias-removal') { const lockPath = join(root, '.nightshift-init-backlog.lock'); const bytes = readFileSync(lockPath); rmSync(lockPath); writeFileSync(lockPath, bytes, { mode: 0o600 }) } } }), 'cleanup-failed')
      assert.equal(existsSync(markerPath), true)
      assert.equal(existsSync(paths.electionNewWitness), true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('retains the upgraded lock and stage when its destination inode changes during rename', () => {
    const root = fixtureRoot()
    const ownerNonce = 'a'.repeat(32)
    try {
      const carried = inspection(root, { git: { ...inspection(root).git, electionRequired: true, kind: 'git', objectFormat: 'sha1', plansPolicy: 'satisfied' } })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const applyRequest = request(root, { inspection: carried, versionControlChoice: 'track' })
      const manifestId = admitApplyManifest(applyRequest).manifestId
      const paths = temporaryPaths(root, manifestId, 1, ownerNonce, carried.snapshotId)
      const writes = []

      expectCode(() => publishApply(applyRequest, { currentInspection: carried, collectInspection: () => carried, ownerNonce, onRenamed: (destination) => {
        if (destination === paths.lock) {
          const bytes = readFileSync(destination)
          writeFileSync(paths.lockNext, bytes, { mode: 0o600 })
        }
      }, writeSpy: (path) => { writes.push(path) } }), 'cleanup-failed')
      assert.equal(existsSync(paths.lock), true)
      assert.equal(existsSync(paths.lockNext), true)
      assert.equal(writes.some((path) => path.includes(ELECTION_MARKER_PATH)), false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('maps initial-state kind drift after lock acquisition and cleans its lock', () => {
    const root = fixtureRoot()
    try {
      const target = join(root, 'FEATURES.md')
      const bytes = Buffer.from('approved\n', 'utf8')
      writeFileSync(target, bytes)
      const carried = inspection(root, { targets: [{ bom: null, cleanTextSha256: null, contentBase64: bytes.toString('base64'), contentRole: 'semantic', editableRegions: [], finalNewline: true, kind: 'file', mode: process.platform === 'win32' ? null : 420, newline: 'lf', rawSha256: sha256(bytes), states: ['present'], target: 'FEATURES.md', templateId: null, templateSha256: null }] })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const applyRequest = request(root, { inspection: carried })

      expectCode(() => publishApply(applyRequest, { currentInspection: carried, onPublished: (destination) => { if (destination.endsWith('.nightshift-init-backlog.lock')) { rmSync(target); mkdirSync(target) } } }), 'filesystem')
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), false)
      assert.equal(statSync(target).isDirectory(), true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('retains a recreated initial lock stage after owner publication', () => {
    const root = fixtureRoot()
    const ownerNonce = 'b'.repeat(32)
    try {
      const carried = inspection(root)
      const applyRequest = request(root, { inspection: carried })
      const paths = temporaryPaths(root, admitApplyManifest(applyRequest).manifestId, 1, ownerNonce, carried.snapshotId)

      expectCode(() => publishApply(applyRequest, { currentInspection: carried, ownerNonce, onPublished: (destination) => { if (destination.endsWith('.nightshift-init-backlog.lock')) { const bytes = readFileSync(destination); rmSync(paths.lockStage); writeFileSync(paths.lockStage, bytes, { mode: 0o600 }) } } }), 'runtime-lock')
      assert.equal(existsSync(paths.lock), true)
      assert.equal(existsSync(paths.lockStage), true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('retains a recreated lock upgrade temporary across response-loss resume', () => {
    const root = fixtureRoot()
    const ownerNonce = 'c'.repeat(32)
    try {
      const carried = inspection(root)
      const applyRequest = request(root, { inspection: carried })
      const paths = temporaryPaths(root, admitApplyManifest(applyRequest).manifestId, 1, ownerNonce, carried.snapshotId)
      const recreate = (destination) => {
        if (destination === paths.lock) {
          writeFileSync(paths.lockNext, readFileSync(destination), { mode: 0o600 })
          rmSync(paths.lockStage)
        }
      }

      const originalNow = Date.now
      const writes = []
      try {
        Date.now = () => 123456789
        expectCode(() => publishApply(applyRequest, { currentInspection: carried, onRenamed: recreate, ownerNonce }), 'cleanup-failed')
        assert.equal(existsSync(paths.lock), true)
        assert.equal(existsSync(paths.lockNext), true)
        const upgradedRecord = JSON.parse(readFileSync(paths.lock, 'utf8'))
        assert.equal(upgradedRecord.manifestId, admitApplyManifest(applyRequest).manifestId)
        assert.equal(upgradedRecord.temporaryPaths.includes(relative(root, paths.lockNext).replaceAll('\\', '/')), true)
        assert.deepEqual(readFileSync(paths.lockNext), readFileSync(paths.lock))
        assert.deepEqual(readFileSync(paths.lockNext), Buffer.from(`${canonicalJson({ ...upgradedRecord, createdAtUnixMs: 123456789 })}\n`, 'utf8'))
        expectCode(() => publishApply(applyRequest, { collectInspection: () => carried, currentInspection: carried, linkSync: (...args) => { writes.push(`link:${args[0]}:${args[1]}`); return linkSync(...args) }, ownerNonce, renameSync: (...args) => { writes.push(`rename:${args[0]}:${args[1]}`); return renameSync(...args) }, resume: true, unlinkSync: (path) => { writes.push(`unlink:${path}`); return unlinkSync(path) }, writeSpy: (path) => { writes.push(`write:${path}`) } }), 'cleanup-failed')
        assert.deepEqual(writes, [])
      } finally {
        Date.now = originalNow
      }
      assert.equal(existsSync(paths.lock), true)
      assert.equal(existsSync(paths.lockNext), true)
      assert.deepEqual(writes, [])
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('retains an in-place mutated initial lock stage after owner stage write', () => {
    const root = fixtureRoot()
    const ownerNonce = 'd'.repeat(32)
    try {
      const carried = inspection(root)
      const applyRequest = request(root, { inspection: carried })
      const paths = temporaryPaths(root, admitApplyManifest(applyRequest).manifestId, 1, ownerNonce, carried.snapshotId)

      expectCode(() => publishApply(applyRequest, { currentInspection: carried, onTransition: (point) => { if (point === 'after-owner-stage-write') writeFileSync(paths.lockStage, Buffer.from('mutated\n', 'utf8')) }, ownerNonce }), 'runtime-lock')
      assert.equal(existsSync(paths.lock), false)
      assert.deepEqual(readFileSync(paths.lockStage), Buffer.from('mutated\n', 'utf8'))
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('retains a partial initial lock stage after a failed owner stage write', () => {
    const root = fixtureRoot()
    const ownerNonce = '1'.repeat(32)
    const pid = process.pid
    try {
      const record = { createdAtUnixMs: 0, manifestId: null, operation: 'apply', ownerNonce, pid, protocolVersion: 1, recoveryId: null, root, temporaryPaths: [], unfinalizedDirectories: [] }
      const stagePath = join(root, `.nightshift-init-backlog.lock.${pid}.${ownerNonce}.new`)
      let writes = 0
      assert.throws(() => createInitialLock(root, record, { ownerNonce, pid, writeSync: (fd, buffer, offset, length, position) => {
        if (writes > 0) return writeSync(fd, buffer, offset, length, position)
        writes += 1
        writeSync(fd, buffer, offset, 1, position)
        throw new Error('partial owner stage write')
      } }), /partial owner stage write/)
      assert.equal(existsSync(stagePath), true)
      assert.deepEqual(readFileSync(stagePath), Buffer.from(`${canonicalJson(record)}\n`, 'utf8').subarray(0, 1))
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('retains a byte-mutated initial lock stage after owner stage creation', () => {
    const root = fixtureRoot()
    const ownerNonce = 'e'.repeat(32)
    try {
      const carried = inspection(root)
      const applyRequest = request(root, { inspection: carried })
      const paths = temporaryPaths(root, admitApplyManifest(applyRequest).manifestId, 1, ownerNonce, carried.snapshotId)

      expectCode(() => publishApply(applyRequest, { currentInspection: carried, onTransition: (point) => {
        if (point === 'after-owner-stage-create') {
          writeFileSync(paths.lockStage, Buffer.from('mutated-before-write\n', 'utf8'))
          throw new Error('stage mutation after creation')
        }
      }, ownerNonce }), 'runtime-lock')
      assert.equal(existsSync(paths.lock), false)
      assert.deepEqual(readFileSync(paths.lockStage), Buffer.from('mutated-before-write\n', 'utf8'))
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('retains a hard-linked initial lock stage after owner stage creation', () => {
    const root = fixtureRoot()
    const ownerNonce = 'f'.repeat(32)
    try {
      const carried = inspection(root)
      const applyRequest = request(root, { inspection: carried })
      const paths = temporaryPaths(root, admitApplyManifest(applyRequest).manifestId, 1, ownerNonce, carried.snapshotId)
      const peerPath = join(root, 'stage-peer')

      expectCode(() => publishApply(applyRequest, { currentInspection: carried, onTransition: (point) => {
        if (point === 'after-owner-stage-create') {
          linkSync(paths.lockStage, peerPath)
          throw new Error('stage hard link after creation')
        }
      }, ownerNonce }), 'runtime-lock')
      assert.equal(existsSync(paths.lock), false)
      assert.equal(existsSync(paths.lockStage), true)
      assert.equal(existsSync(peerPath), true)
      assert.equal(statSync(paths.lockStage).nlink, 2)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('retains a mode-mutated initial lock stage after owner stage creation', () => {
    if (process.platform === 'win32') return

    const root = fixtureRoot()
    const ownerNonce = '0'.repeat(32)
    try {
      const carried = inspection(root)
      const applyRequest = request(root, { inspection: carried })
      const paths = temporaryPaths(root, admitApplyManifest(applyRequest).manifestId, 1, ownerNonce, carried.snapshotId)

      expectCode(() => publishApply(applyRequest, { currentInspection: carried, onTransition: (point) => {
        if (point === 'after-owner-stage-create') {
          chmodSync(paths.lockStage, 0o644)
          throw new Error('stage mode mutation after creation')
        }
      }, ownerNonce }), 'runtime-lock')
      assert.equal(existsSync(paths.lock), false)
      assert.equal(statSync(paths.lockStage).mode & 0o777, 0o644)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('rejects a nonthrowing mode mutation after owner stage creation', () => {
    if (process.platform === 'win32') return

    assertOwnerStageMutationRejected({
      expectedMode: 0o644,
      mutate: (paths) => chmodSync(paths.lockStage, 0o644),
      transition: 'after-owner-stage-create',
    })
  })

  test('rejects a nonthrowing extra link after owner stage creation', () => {
    assertOwnerStageMutationRejected({
      expectedLinks: 2,
      expectedMode: process.platform === 'win32' ? null : 0o600,
      mutate: (paths) => {
        linkSync(paths.lockStage, `${paths.lockStage}.peer`)
      },
      transition: 'after-owner-stage-create',
    })
  })

  test('rejects a nonthrowing identity replacement after owner stage creation', () => {
    const replacementBytes = Buffer.from('replacement-stage\n', 'utf8')
    assertOwnerStageMutationRejected({
      expectedBytes: replacementBytes,
      expectedMode: process.platform === 'win32' ? null : 0o600,
      mutate: (paths) => {
        const replacement = `${paths.lockStage}.replacement`
        rmSync(paths.lockStage)
        writeFileSync(replacement, replacementBytes, { mode: 0o600 })
        renameSync(replacement, paths.lockStage)
      },
      transition: 'after-owner-stage-create',
    })
  })

  test('rejects a nonthrowing byte mutation after owner stage creation', () => {
    const mutated = Buffer.from('mutated-after-create\n', 'utf8')
    assertOwnerStageMutationRejected({
      expectedBytes: mutated,
      expectedMode: process.platform === 'win32' ? null : 0o600,
      mutate: () => {},
      mutateAfterWrite: (paths) => writeFileSync(paths.lockStage, mutated),
      transition: 'after-owner-stage-create',
    })
  })

  test('rejects a nonthrowing mode mutation after owner stage write', () => {
    if (process.platform === 'win32') return

    assertOwnerStageMutationRejected({
      expectedMode: 0o644,
      mutate: (paths) => chmodSync(paths.lockStage, 0o644),
      transition: 'after-owner-stage-write',
    })
  })

  test('rejects a nonthrowing extra link after owner stage write', () => {
    assertOwnerStageMutationRejected({
      expectedLinks: 2,
      expectedMode: process.platform === 'win32' ? null : 0o600,
      mutate: (paths) => linkSync(paths.lockStage, `${paths.lockStage}.peer`),
      transition: 'after-owner-stage-write',
    })
  })

  test('rejects a nonthrowing identity replacement after owner stage write', () => {
    assertOwnerStageMutationRejected({
      expectedMode: process.platform === 'win32' ? null : 0o600,
      mutate: (paths) => {
        const replacement = `${paths.lockStage}.replacement`
        const bytes = readFileSync(paths.lockStage)
        rmSync(paths.lockStage)
        writeFileSync(replacement, bytes, { mode: 0o600 })
        renameSync(replacement, paths.lockStage)
      },
      transition: 'after-owner-stage-write',
    })
  })

  test('rejects a nonthrowing byte mutation after owner stage write', () => {
    const mutated = Buffer.from('mutated-after-write\n', 'utf8')
    assertOwnerStageMutationRejected({
      expectedBytes: mutated,
      expectedMode: process.platform === 'win32' ? null : 0o600,
      mutate: (paths) => writeFileSync(paths.lockStage, mutated),
      transition: 'after-owner-stage-write',
    })
  })

  test('reports post-publication ready failure and retains the external-writer warning', () => {
    const root = fixtureRoot()
    try {
      const readyFailure = new InitBacklogError(failureRecord({ code: 'ready-failed', detail: 'ready parser failed', operation: 'apply', phase: 'verify' }))
      assert.throws(() => publishApply(request(root), { collectInspection: () => { throw readyFailure } }), (error) => error?.record?.code === 'ready-failed' && error.record.phase === 'verify')
      const result = publishApply(request(root), { collectInspection: () => inspection(root) })

      assert.ok(result.warnings.some((item) => item.code === 'external-writer-window'))
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('maps a ready failure after publication and cleans only controller residue', () => {
    const root = fixtureRoot()
    try {
      const action = { id: 'p-ready-failure', kind: 'ensure-directory', mode: process.platform === 'win32' ? null : 493, target: '.claude' }
      const carried = inspection(root, { targets: [{ bom: null, cleanTextSha256: null, contentBase64: null, contentRole: 'none', editableRegions: [], finalNewline: null, kind: 'directory', mode: action.mode, newline: null, rawSha256: null, states: ['missing'], target: action.target, templateId: null, templateSha256: null }], proposals: [{ action, afterBase64: null, beforeBase64: null, condition: 'always', proposalId: action.id, reason: 'missing-target' }] })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      const readyFailure = new InitBacklogError(failureRecord({ code: 'ready-failed', detail: 'ready parser failed after publication', operation: 'apply', phase: 'verify' }))
      let collectionCount = 0
      const applyRequest = request(root, { actions: [action], inspection: carried, proposalDispositions: [{ disposition: 'selected', proposalId: action.id }] })
      const manifestId = admitApplyManifest(applyRequest).manifestId

      assert.throws(() => publishApply(applyRequest, { collectInspection: () => { collectionCount += 1; if (collectionCount === 1) return carried; throw readyFailure } }), (error) => {
        assert.deepEqual(error.record, failureRecord({ code: 'ready-failed', detail: 'ready parser failed after publication', manifestId, operation: 'apply', outcomes: [{ actionId: action.id, status: 'created', target: action.target }], phase: 'verify' }))
        return true
      })
      assert.equal(collectionCount, 2)
      assert.equal(existsSync(join(root, '.claude')), true)
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), false)
      assert.equal(readdirSync(root).some((name) => name.includes('.nightshift-init-backlog.')), false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('rolls back the first post-unwrap ready failure with exact recovery evidence', () => {
    const fixture = unwrapBackupFailureFixture()
    const manifestId = admitApplyManifest(fixture.applyRequest).manifestId
    const expectedRecord = failureRecord({
      code: 'ready-failed',
      detail: 'ready parser failed after unwrap publication',
      manifestId,
      operation: 'apply',
      outcomes: [{ actionId: fixture.applyRequest.actions[0].id, status: 'unwrapped', target: fixture.target }],
      phase: 'verify',
      recovery: { retainedBackups: [], status: 'restored', warnings: [] },
    })
    const readyFailure = new InitBacklogError(failureRecord({ code: 'ready-failed', detail: expectedRecord.detail, operation: 'apply', phase: 'verify' }))
    let collectionCount = 0
    const collectFailure = () => {
      collectionCount += 1
      throw readyFailure
    }
    const applyOptions = { collectInspection: collectFailure, currentInspection: fixture.applyRequest.inspection }
    const expectedBackupPath = join(fixture.root, ...fixture.backupTarget.split('/'))
    try {
      assert.throws(() => publishApply(fixture.applyRequest, applyOptions), (error) => {
        assert.deepEqual(error.record, expectedRecord)
        assert.equal(error.cause, readyFailure)

        return true
      })
      assert.equal(collectionCount, 1)
      assert.deepEqual(readFileSync(join(fixture.root, fixture.target)), fixture.wrapped)
      assert.equal(statSync(join(fixture.root, fixture.target)).mode & 0o777, process.platform === 'win32' ? 0o666 : 0o644)
      assert.equal(existsSync(expectedBackupPath), false)
      assert.equal(existsSync(join(fixture.root, '.nightshift-init-backlog.lock')), false)

      const dispatchActionId = `p-${'a'.repeat(62)}`
      const dispatchAction = { ...fixture.applyRequest.actions[0], id: dispatchActionId }
      const dispatchInspection = {
        ...fixture.applyRequest.inspection,
        proposals: fixture.applyRequest.inspection.proposals.map((proposal) => ({ ...proposal, action: dispatchAction, proposalId: dispatchActionId })),
        targets: fixture.applyRequest.inspection.targets.map((record) => ({ ...record, states: ['present', 'wrapped'] })),
        wrapFindings: fixture.applyRequest.inspection.wrapFindings.map((finding) => ({ ...finding, count: 1, firstLine: 1 })),
      }
      dispatchInspection.snapshotId = deriveSnapshotId({ ...dispatchInspection, snapshotId: null })
      const dispatchRequest = { ...fixture.applyRequest, actions: [dispatchAction], hostContext: dispatchInspection.hostContext, inspection: dispatchInspection, proposalDispositions: [{ disposition: 'selected', proposalId: dispatchActionId }] }
      const dispatchedManifestId = admitApplyManifest(dispatchRequest).manifestId
      const dispatchedRecord = { ...expectedRecord, manifestId: dispatchedManifestId }
      dispatchedRecord.outcomes = [{ ...dispatchedRecord.outcomes[0], actionId: dispatchActionId }]
      const dispatchedBackupPath = join(fixture.root, ...`.tmp/nightshift-init-backlog-unwrap-${dispatchInspection.snapshotId}-${dispatchedManifestId}-${sha256(Buffer.from(fixture.target, 'utf8'))}.bak`.split('/'))
      let dispatchedCollectionCount = 0
      const dispatchCollectFailure = () => {
        dispatchedCollectionCount += 1
        throw readyFailure
      }
      const dispatched = runPrivateDispatcher(Buffer.from(`${canonicalJson(dispatchRequest)}\n`, 'utf8'), {
        apply: (value) => publishApply(value, { ...applyOptions, collectInspection: dispatchCollectFailure, currentInspection: value.inspection }),
      })
      assert.equal(dispatched.exitCode, 1, dispatched.stdout.toString('utf8'))
      assert.equal(dispatchedCollectionCount, 1)
      assert.equal(dispatched.stderr.length, 0)
      assert.deepEqual(JSON.parse(dispatched.stdout.toString('utf8')), dispatchedRecord)
      assert.deepEqual(readFileSync(join(fixture.root, fixture.target)), fixture.wrapped)
      assert.equal(existsSync(dispatchedBackupPath), false)
      assert.equal(existsSync(join(fixture.root, '.nightshift-init-backlog.lock')), false)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('propagates post-inspection ready notices beside the external-writer warning', () => {
    const root = fixtureRoot()
    try {
      const carried = inspection(root)
      const post = inspection(root, { warnings: [{ code: 'nonblocking-ready-notice', detail: '1 ready notice remains.', target: null }] })
      const result = publishApply(request(root, { inspection: carried }), { currentInspection: carried, collectInspection: () => post })

      assert.deepEqual(result.warnings.map((warning) => warning.code), ['external-writer-window', 'nonblocking-ready-notice'])
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
}

module.exports = { runPublicationCases }
