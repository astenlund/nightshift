'use strict'

const assert = require('node:assert/strict')
const { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, relative } = require('node:path')
const test = require('node:test')

const { publishApply, temporaryPaths } = require('../../skills/init-backlog/lib/publication')
const { runPrivateDispatcher } = require('../../skills/init-backlog/init-backlog')
const { admitApplyManifest } = require('../../skills/init-backlog/lib/apply-manifest')
const { InitBacklogError, failureRecord } = require('../../skills/init-backlog/lib/errors')
const { canonicalJson, deriveSnapshotId, sha256, validateResultRecord } = require('../../skills/init-backlog/lib/protocol')
const { createInitialLock } = require('../../skills/init-backlog/lib/filesystem')
const { composeElectionMarker } = require('../../skills/init-backlog/lib/inspection')
const { analyzeCatalog } = require('../../skills/ready/ready')
const { applyRecovery, inspectRecovery } = require('../../skills/init-backlog/lib/recovery')

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
        const markerPath = join(root, '.nightshift-init-backlog-election')

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
      const markerPath = join(root, '.nightshift-init-backlog-election')

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
        const markerPath = join(root, '.nightshift-init-backlog-election')
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
        const markerPath = join(root, '.nightshift-init-backlog-election')
        let collections = 0
        const collect = () => {
          collections += 1
          const markerPresent = existsSync(markerPath)

          return collections === 1 ? carried : inspection(root, { git: { ...carried.git, electionMarker: markerPresent ? 'track' : 'absent', electionMarkerMode: markerPresent && process.platform !== 'win32' ? 384 : null, electionMarkerSnapshotId: markerPresent ? carried.snapshotId : null } })
        }
        assert.throws(() => publishApply(applyRequest, { collectInspection: collect, crash: true, ownerNonce: 'c'.repeat(32), onPublished: (destination) => { if (destination.endsWith('.nightshift-init-backlog-election')) throw new Error('response lost before terminal cleanup') } }), /response lost before terminal cleanup/)
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

  test('preserves an existing election marker mode when rebinding', () => {
    const root = fixtureRoot()
    try {
      const marker = composeElectionMarker('deferred', 'git', true, 'a'.repeat(64), 416, root)
      writeFileSync(join(root, '.nightshift-init-backlog-election'), Buffer.from(marker.contentBase64, 'base64'), { mode: 416 })
      const carried = inspection(root, { git: { ...inspection(root).git, electionMarker: 'deferred', electionMarkerMode: 416, electionMarkerSnapshotId: 'a'.repeat(64), electionRequired: true, kind: 'git', objectFormat: 'sha1', plansPolicy: 'satisfied' } })
      const result = publishApply(request(root, { inspection: carried, versionControlChoice: 'deferred' }), { collectInspection: () => carried })

      assert.equal(result.ok, true)
      if (process.platform !== 'win32') assert.equal(statSync(join(root, '.nightshift-init-backlog-election')).mode & 0o777, 0o640)
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

  test('resumes a response-loss prefix after election-marker publication from live state', () => {
    const root = fixtureRoot()
    try {
      const carried = inspection(root, { git: { ...inspection(root).git, electionMarker: 'absent', electionMarkerMode: null, electionMarkerSnapshotId: null, electionRequired: true, kind: 'git', objectFormat: 'sha1', plansPolicy: 'satisfied' } })
      carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
      let collectionCount = 0
      const collect = () => {
        collectionCount += 1
        if (collectionCount === 1) return carried
        const markerPresent = existsSync(join(root, '.nightshift-init-backlog-election'))
        const markerState = markerPresent ? 'track' : 'absent'
        const markerMode = markerPresent && process.platform !== 'win32' ? 384 : null

        return inspection(root, { git: { ...carried.git, electionMarker: markerState, electionMarkerMode: markerMode, electionMarkerSnapshotId: markerPresent ? carried.snapshotId : null } })
      }
      const applyRequest = request(root, { inspection: carried, versionControlChoice: 'track' })

      assert.throws(() => publishApply(applyRequest, { collectInspection: collect, failAt: 'after-final-verification' }))
      const result = publishApply(applyRequest, { collectInspection: collect, resume: true })

      assert.equal(result.ok, true)
      assert.equal(result.postInspect.git.electionMarker, 'absent')
      assert.equal(existsSync(join(root, '.nightshift-init-backlog-election')), false)
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
      writeFileSync(join(root, '.nightshift-init-backlog-election'), Buffer.from(marker.contentBase64, 'base64'), { mode: carried.git.electionMarkerMode ?? 0o600 })
      const applyRequest = request(root, { inspection: carried, versionControlChoice: 'track' })
      let collectionCount = 0
      const collect = () => {
        collectionCount += 1
        if (collectionCount === 1) return carried
        const markerPresent = existsSync(join(root, '.nightshift-init-backlog-election'))

        return inspection(root, { git: { ...carried.git, electionMarker: markerPresent ? 'track' : 'absent', electionMarkerMode: markerPresent && process.platform !== 'win32' ? carried.git.electionMarkerMode : null, electionMarkerSnapshotId: markerPresent ? carried.snapshotId : null } })
      }

      assert.throws(() => publishApply(applyRequest, { collectInspection: collect, failAt: 'after-final-verification', onRenamed: (destination) => { if (destination.endsWith('.nightshift-init-backlog-election')) throw new Error('response lost after marker replacement') } }), /response lost after marker replacement/)
      assert.equal(existsSync(join(root, '.nightshift-init-backlog-election')), true)
      const result = publishApply(applyRequest, { collectInspection: collect, resume: true })

      assert.equal(result.ok, true)
      assert.equal(result.postInspect.git.electionMarker, 'absent')
      assert.equal(existsSync(join(root, '.nightshift-init-backlog-election')), false)
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
      const temporary = temporaryPaths(root, manifestId, 1, 'e'.repeat(32), carried.snapshotId).action

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
        const present = existsSync(join(root, '.nightshift-init-backlog-election'))

        return inspection(root, { git: { ...carried.git, electionMarker: present ? 'track' : 'absent', electionMarkerMode: present && process.platform !== 'win32' ? 384 : null, electionMarkerSnapshotId: present ? carried.snapshotId : null } })
      }

      assert.throws(() => publishApply(applyRequest, { collectInspection: collect, crash: true, failAt: 'after-mode-assignment', ownerNonce: 'f'.repeat(32) }), /Injected publication failure at after-mode-assignment/)
      assert.equal(existsSync(temporary), true)
      const writes = []
      const result = publishApply(applyRequest, { collectInspection: collect, ownerNonce: 'f'.repeat(32), resume: true, writeSpy: (path) => { writes.push(path) } })

      assert.equal(result.postInspect.git.electionMarker, 'absent')
      assert.equal(writes.some((path) => path.endsWith('.nightshift-init-backlog-election')), true)
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
        const markerPresent = existsSync(join(root, '.nightshift-init-backlog-election'))
        return inspection(root, { git: { ...carried.git, electionMarker: markerPresent ? 'track' : 'absent', electionMarkerMode: markerPresent && process.platform !== 'win32' ? 384 : null, electionMarkerSnapshotId: markerPresent ? carried.snapshotId : null }, proposals: carried.proposals, targets: [{ ...carried.targets[0], states: ['present'] }] })
      }
      const applyRequest = request(root, { actions: [action], inspection: carried, proposalDispositions: [{ disposition: 'selected', proposalId: action.id }], versionControlChoice: 'track' })
      assert.throws(() => publishApply(applyRequest, { collectInspection: collect, failAt: 'after-marker-removal' }))
      assert.equal(existsSync(join(root, '.nightshift-init-backlog-election')), false)
      const writes = []
      const result = publishApply(applyRequest, { collectInspection: collect, resume: true, writeSpy: (path) => { writes.push(path) } })

      assert.equal(result.postInspect.git.electionMarker, 'absent')
      assert.equal(writes.some((path) => path.endsWith('.nightshift-init-backlog-election')), false)
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
      writeFileSync(join(root, '.nightshift-init-backlog-election'), external, { mode: carried.git.electionMarkerMode ?? 0o600 })
      const applyRequest = request(root, { inspection: carried, versionControlChoice: 'track' })

      assert.throws(() => publishApply(applyRequest, { currentInspection: carried }))
      assert.deepEqual(readFileSync(join(root, '.nightshift-init-backlog-election')), external)
      assert.notDeepEqual(readFileSync(join(root, '.nightshift-init-backlog-election')), Buffer.from(approved.contentBase64, 'base64'))
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('rejects a marker replacement whose live mode changed after inspection', () => {
    const root = fixtureRoot()
    try {
      const carriedMode = process.platform === 'win32' ? null : 416
      const marker = composeElectionMarker('deferred', 'git', true, 'a'.repeat(64), carriedMode, root)
      const markerPath = join(root, '.nightshift-init-backlog-election')
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
      const temporary = temporaryPaths(root, manifestId, 1, 'd'.repeat(32), carried.snapshotId).action
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
      const temporary = temporaryPaths(root, manifestId, 1, '9'.repeat(32), carried.snapshotId).action
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
      const collision = temporaryPaths(root, manifestId, 1, 'b'.repeat(32), carried.snapshotId).action
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

      const markerIndex = writes.findIndex((path) => path.endsWith('/.nightshift-init-backlog-election'))
      const directoryIndex = writes.findIndex((path) => path.endsWith('/.claude'))
      assert.ok(markerIndex >= 0 && markerIndex < directoryIndex, writes.join(','))
      assert.equal(existsSync(join(root, '.nightshift-init-backlog-election')), false)
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
        const present = existsSync(join(root, '.nightshift-init-backlog-election'))

        return collections === 1 ? carried : inspection(root, { git: { ...carried.git, electionMarker: present ? 'track' : 'absent', electionMarkerMode: present && process.platform !== 'win32' ? 384 : null, electionMarkerSnapshotId: present ? carried.snapshotId : null } })
      }
      assert.throws(() => publishApply(applyRequest, { collectInspection: collect, ownerNonce, onPublished: (destination) => { if (destination.endsWith('.nightshift-init-backlog-election')) throw new Error('response lost after marker publication') } }))
      assert.equal(existsSync(paths.election), true)
      assert.equal(existsSync(join(root, '.nightshift-init-backlog-election')), true)
      const result = publishApply(applyRequest, { collectInspection: collect, ownerNonce, resume: true })

      assert.equal(result.ok, true)
      assert.equal(existsSync(paths.election), false)
      assert.equal(existsSync(join(root, '.nightshift-init-backlog-election')), false)
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), false)
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

      assert.throws(() => publishApply(request(root, { actions: [action], inspection: carried, proposalDispositions: [{ disposition: 'selected', proposalId: action.id }] }), { collectInspection: () => { collectionCount += 1; if (collectionCount === 1) return carried; throw readyFailure } }), (error) => error instanceof InitBacklogError && error.record.code === 'ready-failed' && error.record.phase === 'verify')
      assert.equal(collectionCount, 2)
      assert.equal(existsSync(join(root, '.claude')), true)
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), false)
      assert.equal(readdirSync(root).some((name) => name.includes('.nightshift-init-backlog.')), false)
    } finally {
      rmSync(root, { force: true, recursive: true })
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
