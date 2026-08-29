'use strict'

const assert = require('node:assert/strict')
const { randomBytes } = require('node:crypto')
const {
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { spawn } = require('node:child_process')
const test = require('node:test')

const { runCli, runPrivateDispatcher } = require('../../skills/init-backlog/init-backlog')
const { InitBacklogError } = require('../../skills/init-backlog/lib/errors')
const {
  MAX_APPLY_REQUEST_BYTES,
  MAX_APPLY_RESULT_BYTES,
  MAX_CONFINED_PATH_BYTES,
  MAX_INLINE_FILE_BYTES,
  MAX_MECHANICAL_FILE_BYTES,
  MAX_INSPECT_REQUEST_BYTES,
  MAX_INSPECT_RESULT_BYTES,
  MAX_RECOVERY_REQUEST_BYTES,
  MAX_RECOVERY_RESULT_BYTES,
  canonicalActionOrder,
  canonicalJson,
  compareOrdinal,
  decodeRequest,
  deriveManifestId,
  deriveProposalId,
  deriveRecoveryId,
  deriveSemanticActionId,
  deriveSnapshotId,
  encodeResult,
  selectFailure,
  validateBase64,
  validateLogicalId,
  validateProposalDispositions,
  validateRequestRecord,
  validateResultRecord,
  validateTarget,
} = require('../../skills/init-backlog/lib/protocol')
const { composeTemplate, loadManifest, normalizeLogicalAsset, validateManifest } = require('../../skills/init-backlog/lib/assets')
const {
  REQUEST_GATE_BASENAME,
  REQUEST_OWNER_BASENAME,
  REQUEST_OWNER_STAGE_BASENAME,
  REQUEST_PAYLOAD_BASENAME,
  cleanRequestResidue,
  classifyPid,
  consumeRequest,
  inspectRequestResidue,
  reserveRequest,
  stableOpenFile,
} = require('../../skills/init-backlog/lib/filesystem')

const DIGEST_A = 'a'.repeat(64)
const DIGEST_B = 'b'.repeat(64)
const NONCE_A = 'a'.repeat(32)

function canonicalRoot(root) {
  return realpathSync.native(root)
}

function codexHostContext() {
  return {
    claudeContextSource: null,
    claudeRootExclusionStatus: null,
    codexContextSource: 'user-confirmed',
    codexInvocationDirectory: '.',
    codexProjectDocMaxBytes: 32768,
    codexProjectInstructions: [],
  }
}

function inspectRequest(root) {
  return {
    host: 'codex',
    hostContext: codexHostContext(),
    operation: 'inspect',
    protocolVersion: 1,
    root,
  }
}

function inspectResult(root) {
  return {
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
    guidance: {
      baseAdapter: 'AGENTS.md',
      candidates: ['AGENTS.md'],
      graphPaths: ['AGENTS.md'],
      imports: [],
      independentPaths: [],
      resolvedTarget: 'AGENTS.md',
    },
    host: 'codex',
    hostContext: codexHostContext(),
    ok: true,
    operation: 'inspect',
    problems: [],
    proposals: [],
    protocolVersion: 1,
    ready: {},
    retainedBackups: [],
    root,
    snapshotId: DIGEST_A,
    targets: [],
    templates: [],
    unwrapReady: { after: {}, targets: [] },
    warnings: [],
    wrapFindings: [],
  }
}

function applyRequest(root) {
  return {
    actions: [],
    host: 'codex',
    hostContext: codexHostContext(),
    inspection: inspectResult(root),
    operation: 'apply',
    proposalDispositions: [],
    protocolVersion: 1,
    root,
    semanticDecisions: [],
    versionControlChoice: 'not-required',
  }
}

function recoveryInspectRequest(root) {
  return {
    host: 'codex',
    hostContext: codexHostContext(),
    operation: 'recover-inspect',
    protocolVersion: 1,
    recoveryKind: 'orphan-lock-stage',
    recoveryTarget: `.nightshift-init-backlog.lock.9.${NONCE_A}.new`,
    root,
  }
}

function recoveryInspectResult(root) {
  return {
    allowedDispositions: ['remove'],
    evidence: {
      backup: null,
      lockStage: {
        mode: process.platform === 'win32' ? null : 0o600,
        ownerNonce: NONCE_A,
        pid: 9,
        pidStatus: 'absent',
        rawSha256: DIGEST_A,
        record: null,
      },
      marker: null,
      owner: null,
      recoveryGate: null,
    },
    host: 'codex',
    hostContext: codexHostContext(),
    ok: true,
    operation: 'recover-inspect',
    protocolVersion: 1,
    recoveryId: DIGEST_B,
    recoveryKind: 'orphan-lock-stage',
    recoveryTarget: `.nightshift-init-backlog.lock.9.${NONCE_A}.new`,
    root,
  }
}

function recoveryApplyRequest(root) {
  return {
    disposition: 'remove',
    host: 'codex',
    hostContext: codexHostContext(),
    operation: 'recover-apply',
    protocolVersion: 1,
    recoveryInspection: recoveryInspectResult(root),
    root,
  }
}

function applyResult(root) {
  return {
    complete: true,
    host: 'codex',
    hostContext: codexHostContext(),
    incompleteTargets: [],
    manifestId: DIGEST_B,
    ok: true,
    operation: 'apply',
    outcomes: [],
    postInspect: inspectResult(root),
    protocolVersion: 1,
    retainedBackups: [],
    root,
    snapshotId: DIGEST_A,
    versionControlChoice: 'not-required',
    warnings: [],
  }
}

function recoveryApplyResult(root) {
  return {
    changedPaths: [`.nightshift-init-backlog.lock.9.${NONCE_A}.new`],
    disposition: 'remove',
    host: 'codex',
    hostContext: codexHostContext(),
    ok: true,
    operation: 'recover-apply',
    protocolVersion: 1,
    recoveryId: DIGEST_B,
    recoveryKind: 'orphan-lock-stage',
    recoveryTarget: `.nightshift-init-backlog.lock.9.${NONCE_A}.new`,
    retainedPaths: [],
    root,
    status: 'completed',
    warnings: [],
  }
}

function failureResult() {
  return {
    actionId: null,
    code: 'invalid-request',
    detail: 'Request is invalid.',
    manifestId: null,
    ok: false,
    operation: null,
    outcomes: [],
    phase: 'decode',
    protocolVersion: 1,
    recovery: { retainedBackups: [], status: 'none', warnings: [] },
    systemCode: null,
    target: null,
  }
}

function clone(value) {
  return structuredClone(value)
}

function expectInitError(action, code, phase) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof InitBacklogError)
    assert.equal(error.record.code, code)
    assert.equal(error.record.phase, phase)

    return true
  })
}

function makeTemporaryRoot() {
  return canonicalRoot(mkdtempSync(join(tmpdir(), 'nightshift-init-backlog-protocol-')))
}

function removeTemporaryRoot(root) {
  rmSync(root, { force: true, recursive: true })
}

function requestPaths(root) {
  const requestDirectory = join(root, REQUEST_GATE_BASENAME)

  return {
    owner: join(requestDirectory, REQUEST_OWNER_BASENAME),
    ownerStage: join(requestDirectory, REQUEST_OWNER_STAGE_BASENAME),
    payload: join(requestDirectory, REQUEST_PAYLOAD_BASENAME),
    requestDirectory,
  }
}

function putPayload(root, value = inspectRequest(root)) {
  const bytes = Buffer.from(canonicalJson(value) + '\n', 'utf8')
  writeFileSync(requestPaths(root).payload, bytes, { flag: 'wx' })

  return bytes
}

function captureStreams() {
  const stdout = []
  const stderr = []

  return {
    stderr: { write: (value) => stderr.push(Buffer.from(value)) },
    stderrBytes: () => Buffer.concat(stderr),
    stdout: { write: (value) => stdout.push(Buffer.from(value)) },
    stdoutBytes: () => Buffer.concat(stdout),
  }
}

function runChild(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.once('error', reject)
    child.once('close', (exitCode) => resolve({ exitCode, stderr: Buffer.concat(stderr), stdout: Buffer.concat(stdout) }))
  })
}

function runProtocolCases(repositoryRoot) {
  test('protocol constants and lexical grammars are closed', () => {
    assert.deepEqual(
      {
        MAX_APPLY_REQUEST_BYTES,
        MAX_APPLY_RESULT_BYTES,
        MAX_CONFINED_PATH_BYTES,
        MAX_INLINE_FILE_BYTES,
        MAX_MECHANICAL_FILE_BYTES,
        MAX_INSPECT_REQUEST_BYTES,
        MAX_INSPECT_RESULT_BYTES,
        MAX_RECOVERY_REQUEST_BYTES,
        MAX_RECOVERY_RESULT_BYTES,
      },
      {
        MAX_APPLY_REQUEST_BYTES: 16777216,
        MAX_APPLY_RESULT_BYTES: 1048576,
        MAX_CONFINED_PATH_BYTES: 4096,
        MAX_INLINE_FILE_BYTES: 65536,
        MAX_MECHANICAL_FILE_BYTES: 131072,
        MAX_INSPECT_REQUEST_BYTES: 65536,
        MAX_INSPECT_RESULT_BYTES: 262144,
        MAX_RECOVERY_REQUEST_BYTES: 1114112,
        MAX_RECOVERY_RESULT_BYTES: 1048576,
      },
    )

    const validIds = ['a', 'a0', 'a-b', 'a.b-c', 'z'.repeat(64)]
    const invalidIds = ['', 'A', '-a', 'a-', '.a', 'a.', 'a..b', 'a_b', 'z'.repeat(65)]
    for (const id of validIds) {
      assert.equal(validateLogicalId(id), id)
    }
    for (const id of invalidIds) {
      assert.throws(() => validateLogicalId(id))
    }

    const validTargets = ['AGENTS.md', '.claude', '.claude/FEATURES.md', 'a/b.c']
    const invalidTargets = ['', '.', '..', '/absolute', 'C:/absolute', 'a//b', 'a/./b', 'a/../b', 'a\\b', 'file://a', 'a/'.repeat(2049) + 'b']
    for (const target of validTargets) {
      assert.equal(validateTarget(target), target)
    }
    for (const target of invalidTargets) {
      assert.throws(() => validateTarget(target))
    }

    const unsafe = `safe${String.fromCodePoint(0x10ffff)}tail`
    assert.throws(() => validateTarget(unsafe, { platform: 'win32' }))
  })

  test('canonical serialization uses code-point key order and rejects non-data values', () => {
    const astral = String.fromCodePoint(0x10000)
    const privateUse = String.fromCodePoint(0xe000)
    const value = { z: 1, [astral]: 3, a: [{ y: true, x: null }], [privateUse]: 2 }
    assert.equal(canonicalJson(value), `{"a":[{"x":null,"y":true}],"z":1,"${privateUse}":2,"${astral}":3}`)
    assert.equal(canonicalJson(JSON.parse('{"__proto__":{"polluted":true},"safe":1}')), '{"__proto__":{"polluted":true},"safe":1}')
    assert.equal(compareOrdinal(privateUse, astral), -1)
    assert.deepEqual(['b', astral, privateUse, 'a'].sort(compareOrdinal), ['a', 'b', privateUse, astral])

    assert.throws(() => canonicalJson({ value: undefined }))
    assert.throws(() => canonicalJson({ value: Number.NaN }))
    assert.throws(() => canonicalJson({ value: 1.5 }))
    assert.throws(() => canonicalJson(new Date()))
    assert.throws(() => canonicalJson(Object.defineProperty({}, 'value', { enumerable: true, get: () => 1 })))
    const sparse = []
    sparse.length = 1
    assert.throws(() => canonicalJson(sparse))
  })

  test('all request records accept their complete shape and reject exact-shape mutations', () => {
    const root = canonicalRoot(repositoryRoot)
    const requests = [inspectRequest(root), applyRequest(root), recoveryInspectRequest(root), recoveryApplyRequest(root)]
    for (const request of requests) {
      assert.deepEqual(validateRequestRecord(request), request)

      const missing = clone(request)
      delete missing.host
      expectInitError(() => validateRequestRecord(missing), 'invalid-request', 'decode')

      const added = { ...request, unexpected: true }
      expectInitError(() => validateRequestRecord(added), 'invalid-request', 'decode')
    }
  })

  test('carried request identities and recovery dispositions are bound to the outer request', () => {
    const root = canonicalRoot(repositoryRoot)
    const otherRoot = makeTemporaryRoot()
    try {
      const apply = applyRequest(root)
      apply.inspection.root = otherRoot
      expectInitError(() => validateRequestRecord(apply), 'manifest-invalid', 'prevalidate')

      const recoveryApply = recoveryApplyRequest(root)
      recoveryApply.recoveryInspection.root = otherRoot
      expectInitError(() => validateRequestRecord(recoveryApply), 'recovery-invalid', 'prevalidate')

      const illegalDisposition = recoveryApplyRequest(root)
      illegalDisposition.disposition = 'cleanup'
      expectInitError(() => validateRequestRecord(illegalDisposition), 'recovery-invalid', 'prevalidate')
    } finally {
      removeTemporaryRoot(otherRoot)
    }
  })

  test('recovery request validation rejects every forged cross-field inspection as recovery-invalid', () => {
    const root = canonicalRoot(repositoryRoot)
    const base = recoveryApplyRequest(root)
    const mutations = [
      ['target grammar', (request) => { request.recoveryInspection.recoveryTarget = '.nightshift-init-backlog.lock' }],
      ['kind and evidence', (request) => { request.recoveryInspection.recoveryKind = 'stale-owner' }],
      ['evidence member', (request) => { request.recoveryInspection.evidence.owner = { ...request.recoveryInspection.evidence.lockStage } }],
      ['classification', (request) => { request.recoveryInspection.evidence.lockStage.record = { protocolVersion: 1 } }],
      ['dispositions', (request) => { request.recoveryInspection.allowedDispositions = ['cleanup'] }],
    ]
    for (const [label, mutate] of mutations) {
      const request = clone(base)
      mutate(request)
      assert.throws(() => validateRequestRecord(request), (error) => error.record?.code === 'recovery-invalid' && error.record.phase === 'prevalidate', label)
    }

    const backup = clone(base)
    backup.recoveryInspection.recoveryKind = 'abandoned-backup'
    backup.recoveryInspection.recoveryTarget = `.tmp/nightshift-init-backlog-unwrap-${DIGEST_A}-${DIGEST_B}-${DIGEST_A}.bak`
    backup.recoveryInspection.evidence = {
      backup: { backupContentBase64: 'YQ==', backupMode: null, backupRawSha256: DIGEST_A, classification: 'orphan', currentContentBase64: null, currentMode: null, currentRawSha256: null, currentTarget: null },
      lockStage: null,
      marker: null,
      owner: null,
      recoveryGate: null,
    }
    backup.recoveryInspection.allowedDispositions = ['remove']
    for (const mutate of [
      (request) => { request.recoveryInspection.evidence.backup.classification = 'divergent' },
      (request) => { request.recoveryInspection.evidence.backup.currentTarget = 'FEATURES.md' },
      (request) => { request.recoveryInspection.allowedDispositions = ['restore', 'accept'] },
    ]) {
      const request = clone(backup)
      mutate(request)
      expectInitError(() => validateRequestRecord(request), 'recovery-invalid', 'prevalidate')
    }
  })

  test('apply request validation enforces complete proposal disposition coverage', () => {
    const root = canonicalRoot(repositoryRoot)
    const proposal = {
      action: { id: 'p-' + '1'.repeat(62), kind: 'ensure-directory', mode: null, target: '.claude' },
      afterBase64: null,
      beforeBase64: null,
      condition: 'always',
      proposalId: 'p-' + '1'.repeat(62),
      reason: 'missing-target',
    }
    const request = applyRequest(root)
    request.inspection.proposals = [proposal]
    request.proposalDispositions = [{ disposition: 'selected', proposalId: proposal.proposalId }]
    assert.deepEqual(validateRequestRecord(request), request)

    for (const mutation of [
      { ...request, proposalDispositions: [] },
      { ...request, proposalDispositions: [...request.proposalDispositions, { disposition: 'selected', proposalId: 'p-' + '2'.repeat(62) }] },
      { ...request, proposalDispositions: [{ disposition: 'condition-not-selected', proposalId: proposal.proposalId }] },
    ]) {
      expectInitError(() => validateRequestRecord(mutation), 'manifest-invalid', 'prevalidate')
    }
  })

  test('raw request decoding rejects duplicate, reordered, malformed, and unsafe records in fixed precedence', () => {
    const root = canonicalRoot(repositoryRoot)
    const request = inspectRequest(root)
    const canonical = canonicalJson(request)
    assert.deepEqual(decodeRequest(Buffer.from(canonical + '\n', 'utf8')), request)

    const reordered = `{"root":${JSON.stringify(root)},"protocolVersion":1,"operation":"inspect","hostContext":${canonicalJson(codexHostContext())},"host":"codex"}`
    expectInitError(() => decodeRequest(Buffer.from(reordered, 'utf8')), 'invalid-request', 'decode')

    const duplicate = canonical.replace('"host":"codex"', '"host":"codex","host":"codex"')
    expectInitError(() => decodeRequest(Buffer.from(duplicate, 'utf8')), 'invalid-request', 'decode')
    expectInitError(() => decodeRequest(Buffer.from('{', 'utf8')), 'invalid-json', 'decode')

    const tooLargeBeforeParse = Buffer.alloc(MAX_APPLY_REQUEST_BYTES + 1, 0x20)
    expectInitError(() => decodeRequest(tooLargeBeforeParse), 'payload-too-large', 'decode')

    const oversizedInspect = { ...request, extra: 'x'.repeat(MAX_INSPECT_REQUEST_BYTES) }
    expectInitError(() => decodeRequest(Buffer.from(canonicalJson(oversizedInspect), 'utf8')), 'payload-too-large', 'decode')

    const unsafe = clone(request)
    unsafe.root = `${root}${String.fromCodePoint(0x10ffff)}`
    expectInitError(() => validateRequestRecord(unsafe, { platform: 'win32' }), 'invalid-request', 'decode')
  })

  test('guidance imports and predicted editable regions have closed ordering and range grammar', () => {
    const root = canonicalRoot(repositoryRoot)
    const inspection = inspectResult(root)
    inspection.guidance.imports = [
      { adapterCandidate: false, source: 'z.md', target: 'z.child.md' },
      { adapterCandidate: false, source: 'a.md', target: 'a.child.md' },
    ]
    assert.throws(() => validateResultRecord(inspection))
    inspection.guidance.imports.reverse()
    assert.deepEqual(validateResultRecord(inspection), inspection)
    inspection.guidance.imports.push({ adapterCandidate: false, source: 'a.md', target: 'a.child.md' })
    assert.throws(() => validateResultRecord(inspection))

    const valid = inspectResult(root)
    valid.wrapFindings = [{
      beforeRawSha256: DIGEST_A,
      count: 1,
      firstLine: 1,
      predictedContentBase64: 'YQ==',
      predictedEditableRegions: [{ endByte: 1, regionId: 'a', startByte: 0 }],
      predictedRawSha256: DIGEST_B,
      target: 'AGENTS.md',
    }]
    assert.deepEqual(validateResultRecord(valid), valid)
    for (const regions of [
      [{ endByte: 1, regionId: 'b', startByte: 0 }, { endByte: 1, regionId: 'a', startByte: 0 }],
      [{ endByte: 1, regionId: 'a', startByte: 0 }, { endByte: 1, regionId: 'a', startByte: 0 }],
    ]) {
      const mutation = clone(valid)
      mutation.wrapFindings[0].predictedEditableRegions = regions
      assert.throws(() => validateResultRecord(mutation))
    }
  })

  test('all result records accept complete shapes, reject extra keys, and emit canonical bytes', () => {
    const root = canonicalRoot(repositoryRoot)
    const results = [inspectResult(root), applyResult(root), recoveryInspectResult(root), recoveryApplyResult(root), failureResult()]
    for (const result of results) {
      assert.deepEqual(validateResultRecord(result), result)
      const added = { ...result, unexpected: true }
      assert.throws(() => validateResultRecord(added))
      assert.deepEqual(encodeResult(result), Buffer.from(canonicalJson(result) + '\n', 'utf8'))
    }

    const oversized = clone(inspectResult(root))
    oversized.ready = { detail: 'x'.repeat(MAX_INSPECT_RESULT_BYTES) }
    expectInitError(() => encodeResult(oversized), 'payload-too-large', 'inspect')
  })

  test('canonical Base64 and bounded inline images reject alternate spellings and overflow', () => {
    assert.deepEqual(validateBase64(''), Buffer.alloc(0))
    assert.deepEqual(validateBase64('YQ=='), Buffer.from('a'))
    for (const invalid of ['YQ', 'YQ=', 'YQ===', 'YQ--', 'Y Q==']) {
      assert.throws(() => validateBase64(invalid))
    }
    assert.throws(() => validateBase64(Buffer.alloc(MAX_INLINE_FILE_BYTES + 1).toString('base64')))
  })

  test('proposal dispositions cover every proposal exactly and select only the governing condition', () => {
    const proposals = [
      { condition: 'always', proposalId: 'p-' + '1'.repeat(62), target: '.claude' },
      { condition: 'newline-crlf', proposalId: 'p-' + '2'.repeat(62), target: 'AGENTS.md' },
      { condition: 'newline-lf', proposalId: 'p-' + '3'.repeat(62), target: 'AGENTS.md' },
      { condition: 'version-control-ignore', proposalId: 'p-' + '4'.repeat(62), target: '.gitignore' },
    ]
    const valid = [
      { disposition: 'selected', proposalId: proposals[0].proposalId },
      { disposition: 'condition-not-selected', proposalId: proposals[1].proposalId },
      { disposition: 'selected', proposalId: proposals[2].proposalId },
      { disposition: 'selected', proposalId: proposals[3].proposalId },
    ]
    assert.deepEqual(validateProposalDispositions(proposals, valid, { versionControlChoice: 'ignore' }), valid)

    const mutations = [
      valid.slice(0, -1),
      [...valid, { disposition: 'selected', proposalId: 'p-' + '5'.repeat(62) }],
      [...valid, valid[0]],
      [valid[1], valid[0], ...valid.slice(2)],
      valid.map((item, index) => index === 1 ? { ...item, disposition: 'selected' } : item),
    ]
    for (const mutation of mutations) {
      expectInitError(
        () => validateProposalDispositions(proposals, mutation, { versionControlChoice: 'ignore' }),
        'manifest-invalid',
        'prevalidate',
      )
    }
  })

  test('newline alternatives require an explicit LF or CRLF choice when target newline is unresolved', () => {
    const root = canonicalRoot(repositoryRoot)
    const target = {
      bom: null,
      cleanTextSha256: null,
      contentBase64: null,
      contentRole: 'none',
      editableRegions: [],
      finalNewline: null,
      kind: 'file',
      mode: null,
      newline: null,
      rawSha256: null,
      states: ['missing'],
      target: 'AGENTS.md',
      templateId: null,
      templateSha256: null,
    }
    const proposals = [
      {
        action: { id: 'p-' + '1'.repeat(62), kind: 'create-from-template', mode: null, newline: 'lf', target: 'AGENTS.md', templateId: 'backlog.bugs' },
        afterBase64: null,
        beforeBase64: null,
        condition: 'newline-lf',
        proposalId: 'p-' + '1'.repeat(62),
        reason: 'missing-target',
      },
      {
        action: { id: 'p-' + '2'.repeat(62), kind: 'create-from-template', mode: null, newline: 'crlf', target: 'AGENTS.md', templateId: 'backlog.bugs' },
        afterBase64: null,
        beforeBase64: null,
        condition: 'newline-crlf',
        proposalId: 'p-' + '2'.repeat(62),
        reason: 'missing-target',
      },
    ]
    const context = { versionControlChoice: 'not-required' }
    const lfChoice = [
      { disposition: 'selected', proposalId: proposals[0].proposalId },
      { disposition: 'condition-not-selected', proposalId: proposals[1].proposalId },
    ]
    const crlfChoice = [
      { disposition: 'condition-not-selected', proposalId: proposals[0].proposalId },
      { disposition: 'selected', proposalId: proposals[1].proposalId },
    ]
    assert.deepEqual(validateProposalDispositions(proposals, lfChoice, context), lfChoice)
    assert.deepEqual(validateProposalDispositions(proposals, crlfChoice, context), crlfChoice)

    for (const mutation of [
      [
        { disposition: 'condition-not-selected', proposalId: proposals[0].proposalId },
        { disposition: 'condition-not-selected', proposalId: proposals[1].proposalId },
      ],
      [
        { disposition: 'selected', proposalId: proposals[0].proposalId },
        { disposition: 'selected', proposalId: proposals[1].proposalId },
      ],
      [
        { disposition: 'selected', proposalId: proposals[0].proposalId },
      ],
    ]) {
      expectInitError(() => validateProposalDispositions(proposals, mutation, context), 'manifest-invalid', 'prevalidate')
    }

    const duplicateProposals = [...proposals, {
      ...proposals[0],
      action: { ...proposals[0].action, id: 'p-' + '3'.repeat(62) },
      proposalId: 'p-' + '3'.repeat(62),
    }]
    expectInitError(
      () => validateProposalDispositions(duplicateProposals, [...lfChoice, { disposition: 'selected', proposalId: 'p-' + '3'.repeat(62) }], context),
      'manifest-invalid',
      'prevalidate',
    )
    const malformedProposals = [{ ...proposals[0], condition: 'newline-invalid' }, proposals[1]]
    expectInitError(() => validateProposalDispositions(malformedProposals, lfChoice, context), 'manifest-invalid', 'prevalidate')

    const request = applyRequest(root)
    request.inspection.targets = [target]
    request.inspection.proposals = proposals
    request.proposalDispositions = lfChoice
    assert.deepEqual(validateRequestRecord(request), request)
    request.proposalDispositions = crlfChoice
    assert.deepEqual(validateRequestRecord(request), request)
    request.proposalDispositions = [
      { disposition: 'condition-not-selected', proposalId: proposals[0].proposalId },
      { disposition: 'condition-not-selected', proposalId: proposals[1].proposalId },
    ]
    expectInitError(() => validateRequestRecord(request), 'manifest-invalid', 'prevalidate')
  })

  test('canonical action ordering applies phase, depth, ordinal target, and same-target chain position', () => {
    const actions = [
      { id: 'p-' + '1'.repeat(62), kind: 'ensure-directory', mode: null, target: '.claude/features' },
      { id: 'p-' + '2'.repeat(62), kind: 'ensure-directory', mode: null, target: '.claude' },
      { afterRawSha256: DIGEST_B, beforeRawSha256: DIGEST_A, id: 'p-' + '3'.repeat(62), kind: 'unwrap-file', mode: null, target: '.claude/FEATURES.md' },
      { id: 'p-' + '4'.repeat(62), kind: 'create-from-template', mode: null, newline: 'lf', target: '.claude/BUGS.md', templateId: 'backlog.bugs' },
      { afterBase64: 'Yg==', beforeBase64: 'YQ==', id: 's-' + '5'.repeat(62), kind: 'exact-edit', regionId: 'features.document-preamble', target: '.claude/FEATURES.md' },
    ]
    const expected = [actions[1], actions[0], actions[2], actions[3], actions[4]]
    assert.deepEqual(canonicalActionOrder(actions), expected)
    assert.throws(() => canonicalActionOrder([actions[0], actions[0]]))

    const firstEdit = { afterBase64: 'Yg==', beforeBase64: 'YQ==', id: 's-' + '6'.repeat(62), kind: 'exact-edit', regionId: 'a', target: 'AGENTS.md' }
    const secondEdit = { afterBase64: 'Yw==', beforeBase64: 'Yg==', id: 's-' + '7'.repeat(62), kind: 'exact-edit', regionId: 'b', target: 'AGENTS.md' }
    assert.deepEqual(canonicalActionOrder([secondEdit, firstEdit]), [firstEdit, secondEdit])
    assert.throws(() => canonicalActionOrder([
      firstEdit,
      { ...secondEdit, beforeBase64: 'YQ==' },
    ]))
  })

  test('canonical identities bind complete protocol projections', () => {
    const root = canonicalRoot(repositoryRoot)
    const inspection = inspectResult(root)
    const snapshotId = deriveSnapshotId({ ...inspection, snapshotId: null })
    assert.match(snapshotId, /^[a-f0-9]{64}$/)
    assert.notEqual(snapshotId, deriveSnapshotId({ ...inspection, snapshotId: null, ready: { changed: true } }))

    const manifestId = deriveManifestId({ actions: [], proposalDispositions: [], semanticDecisions: [], snapshotId, versionControlChoice: 'not-required' })
    assert.match(manifestId, /^[a-f0-9]{64}$/)
    assert.notEqual(manifestId, deriveManifestId({ actions: [], proposalDispositions: [], semanticDecisions: [], snapshotId, versionControlChoice: 'deferred' }))

    const proposal = { actionWithoutId: { kind: 'ensure-directory', mode: null, target: '.claude' }, afterBase64: null, beforeBase64: null, condition: 'always', reason: 'missing-target' }
    assert.match(deriveProposalId(proposal), /^p-[a-f0-9]{62}$/)
    assert.match(deriveSemanticActionId({ afterBase64: 'Yg==', beforeBase64: 'YQ==', kind: 'exact-edit', regionId: 'a.b', target: 'AGENTS.md' }), /^s-[a-f0-9]{62}$/)

    const recovery = recoveryInspectResult(root)
    assert.match(deriveRecoveryId({ ...recovery, recoveryId: null }), /^[a-f0-9]{64}$/)
  })

  test('failure selection preserves phase and closed same-phase precedence', () => {
    const candidates = [
      { code: 'filesystem', phase: 'publish' },
      { code: 'snapshot-drift', phase: 'prevalidate' },
      { code: 'manifest-invalid', phase: 'prevalidate' },
      { code: 'invalid-target', phase: 'prevalidate' },
      { code: 'payload-too-large', phase: 'decode' },
    ]
    assert.deepEqual(selectFailure(candidates), candidates[4])
    assert.deepEqual(selectFailure(candidates.slice(1, 4)), candidates[3])
    assert.deepEqual(selectFailure([{ code: 'invalid-request', phase: 'decode' }, { code: 'invalid-json', phase: 'decode' }]), { code: 'invalid-json', phase: 'decode' })
  })

  test('logical asset normalization is checkout-independent and composition inserts no bytes', () => {
    const lf = normalizeLogicalAsset(Buffer.from('one\ntwo\n', 'utf8'))
    const crlf = normalizeLogicalAsset(Buffer.from('one\r\ntwo\r\n', 'utf8'))
    assert.deepEqual(lf.logicalBytes, Buffer.from('one\ntwo\n', 'utf8'))
    assert.deepEqual(crlf.logicalBytes, lf.logicalBytes)
    assert.equal(lf.logicalSha256, crlf.logicalSha256)
    assert.equal(lf.finalNewline, true)

    const second = normalizeLogicalAsset(Buffer.from('three\n', 'utf8'))
    const composition = composeTemplate([lf, second])
    assert.deepEqual(composition.logicalBytes, Buffer.from('one\ntwo\nthree\n', 'utf8'))

    const invalidInputs = [
      Buffer.from([0xef, 0xbb, 0xbf, 0x61]),
      Buffer.from([0x61, 0x00]),
      Buffer.from('one\r\ntwo\n', 'utf8'),
      Buffer.from('one\rtwo', 'utf8'),
      Buffer.from([0xff]),
    ]
    for (const bytes of invalidInputs) {
      assert.throws(() => normalizeLogicalAsset(bytes))
    }
  })

  test('manifest loading accepts a canonical CRLF checkout', () => {
    const root = makeTemporaryRoot()
    const sourceTemplatesRoot = join(repositoryRoot, 'skills', 'init-backlog', 'templates')
    const templatesRoot = join(root, 'templates')
    try {
      cpSync(sourceTemplatesRoot, templatesRoot, { recursive: true })
      const manifestPath = join(templatesRoot, 'manifest.json')
      const logicalManifest = normalizeLogicalAsset(readFileSync(manifestPath)).logicalBytes.toString('utf8')
      writeFileSync(manifestPath, Buffer.from(logicalManifest.replaceAll('\n', '\r\n'), 'utf8'))

      const loaded = loadManifest(templatesRoot)

      assert.equal(loaded.manifest.protocolVersion, 1)
      assert.equal(loaded.assets.size, loaded.manifest.assets.length)
      assert.equal(loaded.templates.size, loaded.manifest.templates.length)
    } finally {
      removeTemporaryRoot(root)
    }
  })

  test('manifest validation pins closed records, ordering, references, and logical asset identities', () => {
    const templatesRoot = join(repositoryRoot, 'skills', 'init-backlog', 'templates')
    const loaded = loadManifest(templatesRoot)
    assert.equal(loaded.manifest.protocolVersion, 1)
    assert.equal(loaded.assets.size, loaded.manifest.assets.length)
    assert.equal(loaded.templates.size, loaded.manifest.templates.length)
    assert.deepEqual(validateManifest(clone(loaded.manifest)), loaded.manifest)

    const mutations = []
    const missing = clone(loaded.manifest)
    missing.assets.pop()
    mutations.push(missing)
    const added = clone(loaded.manifest)
    added.assets.push({ assetId: 'unknown.asset', finalNewline: true, logicalSha256: DIGEST_A, path: 'unknown.md' })
    mutations.push(added)
    const duplicate = clone(loaded.manifest)
    duplicate.assets.splice(1, 0, clone(duplicate.assets[0]))
    mutations.push(duplicate)
    const reordered = clone(loaded.manifest)
    ;[reordered.assets[0], reordered.assets[1]] = [reordered.assets[1], reordered.assets[0]]
    mutations.push(reordered)
    const wrongReference = clone(loaded.manifest)
    wrongReference.templates[0].assetIds = ['unknown.asset']
    mutations.push(wrongReference)
    const wrongTargetRule = clone(loaded.manifest)
    wrongTargetRule.targets[0].templateRule = 'backlog.bugs'
    mutations.push(wrongTargetRule)
    const wrongCondition = clone(loaded.manifest)
    wrongCondition.targets.find((item) => item.targetSelector === '.gitignore').applicability = 'always'
    mutations.push(wrongCondition)
    const wrongKeys = clone(loaded.manifest)
    wrongKeys.assets[0].extra = true
    mutations.push(wrongKeys)
    const wrongKind = clone(loaded.manifest)
    wrongKind.targets.find((item) => item.targetSelector === '.claude/BUGS.md').kind = 'directory'
    mutations.push(wrongKind)
    const missingConcepts = clone(loaded.manifest)
    missingConcepts.targets.find((item) => item.targetSelector === '.claude/BUGS.md').conceptIds = []
    mutations.push(missingConcepts)
    const missingRegions = clone(loaded.manifest)
    missingRegions.targets.find((item) => item.targetSelector === '.claude/BUGS.md').regions = []
    mutations.push(missingRegions)

    for (const mutation of mutations) {
      assert.throws(() => validateManifest(mutation))
    }
  })

  test('manifest loading rejects a linked template root before resolving assets', () => {
    if (process.platform === 'win32') {
      return
    }
    const root = makeTemporaryRoot()
    const templatesRoot = join(repositoryRoot, 'skills', 'init-backlog', 'templates')
    const linkedRoot = join(root, 'templates')
    try {
      symlinkSync(templatesRoot, linkedRoot)
      assert.throws(
        () => loadManifest(linkedRoot),
        (error) => error instanceof InitBacklogError && error.record.code === 'template-invalid' && error.record.phase === 'inspect',
      )
    } finally {
      removeTemporaryRoot(root)
    }
  })

  test('stable open enforces raw bytes, ordinary nonlinked identity, and confinement', () => {
    const root = makeTemporaryRoot()
    try {
      const target = join(root, 'target.txt')
      writeFileSync(target, Buffer.from('stable', 'utf8'))
      const opened = stableOpenFile(root, target)
      assert.deepEqual(opened.bytes, Buffer.from('stable', 'utf8'))
      assert.match(opened.rawSha256, /^[a-f0-9]{64}$/)

      const hardLink = join(root, 'hard.txt')
      linkSync(target, hardLink)
      assert.throws(() => stableOpenFile(root, target, { requireSingleLink: true }))
      rmSync(hardLink)

      const outside = join(tmpdir(), `nightshift-outside-${randomBytes(8).toString('hex')}`)
      writeFileSync(outside, Buffer.from('outside', 'utf8'))
      try {
        assert.throws(() => stableOpenFile(root, outside))
        if (process.platform !== 'win32') {
          const link = join(root, 'link.txt')
          symlinkSync(outside, link)
          assert.throws(() => stableOpenFile(root, link))
        }
      } finally {
        rmSync(outside, { force: true })
      }
    } finally {
      removeTemporaryRoot(root)
    }
  })

  test('request residue rejects an oversized payload before reading its bytes', () => {
    const root = makeTemporaryRoot()
    try {
      reserveRequest(root, { nonce: NONCE_A })
      writeFileSync(requestPaths(root).payload, Buffer.alloc(0), { flag: 'wx' })
      truncateSync(requestPaths(root).payload, MAX_APPLY_REQUEST_BYTES + 1)
      assert.throws(
        () => inspectRequestResidue(root),
        (error) => error instanceof InitBacklogError && error.record.code === 'request-filesystem',
      )
    } finally {
      removeTemporaryRoot(root)
    }
  })

  test('request residue bounds owner records at the inspect-request ceiling', () => {
    for (const extraBytes of [0, 1]) {
      const root = makeTemporaryRoot()
      try {
        reserveRequest(root, { nonce: NONCE_A })
        writeFileSync(requestPaths(root).owner, Buffer.alloc(MAX_INSPECT_REQUEST_BYTES + extraBytes, 0x61))

        assert.throws(
          () => inspectRequestResidue(root),
          (error) => error instanceof InitBacklogError && error.record.code === 'request-filesystem' && (extraBytes === 0 ? error.cause?.code !== 'file-too-large' : error.cause?.code === 'file-too-large'),
        )
      } finally {
        removeTemporaryRoot(root)
      }
    }
  })

  test('PID classification is total and fail-closed', () => {
    assert.equal(classifyPid(9, () => undefined), 'live')
    assert.equal(classifyPid(9, () => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }) }), 'absent')
    assert.equal(classifyPid(9, () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }) }), 'indeterminate')
    assert.equal(classifyPid(9, () => { throw new Error('unexpected') }), 'indeterminate')
  })

  test('request reservation crash prefixes expose every reserved-owner durable state', () => {
    const cases = [
      ['empty-gate', 'after-gate-create'],
      ['owner-stage', 'after-owner-stage-create'],
      ['owner-stage', 'after-owner-stage-write'],
      ['published-owner-stage', 'after-owner-publish'],
      ['reserved', 'after-owner-stage-remove'],
    ]
    for (const [expectedState, crashPoint] of cases) {
      const root = makeTemporaryRoot()
      try {
        assert.throws(() => reserveRequest(root, { nonce: NONCE_A, onTransition: (point) => {
          if (point === crashPoint) {
            throw new Error('injected crash')
          }
        } }))
        const inspection = inspectRequestResidue(root)
        assert.equal(inspection.state, expectedState)
        assert.equal(inspection.cleanupAllowed, true)
        cleanRequestResidue(root, inspection)
        assert.equal(existsSync(requestPaths(root).requestDirectory), false)
      } finally {
        removeTemporaryRoot(root)
      }
    }
  })

  test('request consumption crash prefixes expose payload, stage, owner, and cleanup states', () => {
    const cases = [
      ['reserved-payload', 'before-consuming-stage'],
      ['consuming-stage-payload', 'after-consuming-stage-create'],
      ['consuming-stage-payload', 'after-consuming-stage-write'],
      ['consuming-payload', 'after-consuming-owner-publish'],
      ['consuming-owner', 'after-payload-remove'],
      ['empty-gate', 'after-owner-remove'],
    ]
    for (const [expectedState, crashPoint] of cases) {
      const root = makeTemporaryRoot()
      try {
        reserveRequest(root, { nonce: NONCE_A })
        putPayload(root)
        assert.throws(() => consumeRequest(root, NONCE_A, () => assert.fail('dispatch ran before cleanup'), {
          onTransition: (point) => {
            if (point === crashPoint) {
              throw new Error('injected crash')
            }
          },
          pid: 999999,
        }))
        const inspection = inspectRequestResidue(root, { killProcess: () => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }) } })
        assert.equal(inspection.state, expectedState)
        assert.equal(inspection.cleanupAllowed, true)
        cleanRequestResidue(root, inspection, { killProcess: () => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }) } })
      } finally {
        removeTemporaryRoot(root)
      }
    }
  })

  test('consume retains exact request bytes, cleans before dispatch, and leaves no support directory', () => {
    const root = makeTemporaryRoot()
    try {
      reserveRequest(root, { nonce: NONCE_A })
      const requestBytes = putPayload(root)
      let dispatched = false
      const result = consumeRequest(root, NONCE_A, (bytes) => {
        assert.deepEqual(bytes, requestBytes)
        assert.equal(existsSync(requestPaths(root).requestDirectory), false)
        dispatched = true

        return { exitCode: 0, stderr: Buffer.alloc(0), stdout: Buffer.from('{"ok":true}\n', 'utf8') }
      }, { pid: process.pid })
      assert.equal(dispatched, true)
      assert.equal(result.exitCode, 0)
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.requests')), false)
    } finally {
      removeTemporaryRoot(root)
    }
  })

  test('public request consumption rejects a payload rooted outside its request gate', () => {
    const gateRoot = makeTemporaryRoot()
    const payloadRoot = makeTemporaryRoot()
    try {
      reserveRequest(gateRoot, { nonce: NONCE_A })
      putPayload(gateRoot, inspectRequest(payloadRoot))
      const streams = captureStreams()
      let dispatched = false

      const exitCode = runCli({
        argv: ['--consume-request', gateRoot, NONCE_A],
        handlers: {
          inspect: () => {
            dispatched = true

            return inspectResult(payloadRoot)
          },
        },
        stderr: streams.stderr,
        stdout: streams.stdout,
      })

      assert.equal(exitCode, 2)
      assert.equal(dispatched, false)
      assert.equal(streams.stderrBytes().length, 0)
      assert.equal(JSON.parse(streams.stdoutBytes().toString('utf8')).code, 'invalid-request')
      assert.equal(existsSync(requestPaths(gateRoot).requestDirectory), false)
    } finally {
      removeTemporaryRoot(gateRoot)
      removeTemporaryRoot(payloadRoot)
    }
  })

  test('owner records that are not plain objects raise the schema error on residue and consume paths', () => {
    const schemaInvalid = (error) => error instanceof InitBacklogError && error.record.code === 'request-filesystem' && !(error.cause instanceof TypeError) && error.cause?.message === 'Published request owner schema is invalid'
    for (const stored of ['null\n', '[]\n', '"reserved"\n']) {
      const root = makeTemporaryRoot()
      try {
        reserveRequest(root, { nonce: NONCE_A })
        putPayload(root)
        writeFileSync(requestPaths(root).owner, Buffer.from(stored, 'utf8'))
        assert.throws(() => inspectRequestResidue(root), schemaInvalid)
        assert.throws(() => consumeRequest(root, NONCE_A, () => assert.fail('dispatch ran for an invalid owner record')), schemaInvalid)
      } finally {
        removeTemporaryRoot(root)
      }
    }
  })

  test('residue inspection is stable and rejects wrong kind, links, extra entries, and digest drift', () => {
    const mutators = [
      (root) => mkdirSync(requestPaths(root).owner),
      (root) => writeFileSync(join(requestPaths(root).requestDirectory, 'extra'), Buffer.alloc(0)),
    ]
    if (process.platform !== 'win32') {
      mutators.push((root) => symlinkSync(join(root, 'outside'), requestPaths(root).owner))
    }

    for (const mutate of mutators) {
      const root = makeTemporaryRoot()
      try {
        mkdirSync(requestPaths(root).requestDirectory)
        mutate(root)
        assert.throws(() => inspectRequestResidue(root))
      } finally {
        removeTemporaryRoot(root)
      }
    }

    const root = makeTemporaryRoot()
    try {
      reserveRequest(root, { nonce: NONCE_A })
      putPayload(root)
      const evidence = inspectRequestResidue(root)
      writeFileSync(requestPaths(root).payload, Buffer.from('changed', 'utf8'))
      assert.throws(() => cleanRequestResidue(root, evidence), (error) => error instanceof InitBacklogError && error.record.code === 'request-evidence-mismatch')

      writeFileSync(requestPaths(root).payload, Buffer.from(canonicalJson(inspectRequest(root)) + '\n', 'utf8'))
      const fresh = inspectRequestResidue(root)
      assert.throws(() => cleanRequestResidue(root, { ...fresh, nonce: 'b'.repeat(32) }), (error) => error instanceof InitBacklogError && error.record.code === 'request-evidence-mismatch')

      assert.throws(() => consumeRequest(root, NONCE_A, () => undefined, {
        onTransition: (point) => {
          if (point === 'after-consuming-stage-write') {
            throw new Error('injected crash')
          }
        },
      }))
      const staged = inspectRequestResidue(root)
      writeFileSync(requestPaths(root).ownerStage, Buffer.from('changed stage', 'utf8'))
      assert.throws(() => cleanRequestResidue(root, staged), (error) => error instanceof InitBacklogError && error.record.code === 'request-evidence-mismatch')
      const changedStage = inspectRequestResidue(root)
      assert.throws(() => cleanRequestResidue(root, { ...changedStage, ownerStageRawSha256: null }), (error) => error instanceof InitBacklogError && error.record.code === 'request-evidence-mismatch')
      cleanRequestResidue(root, changedStage)
    } finally {
      removeTemporaryRoot(root)
    }
  })

  test('empty-gate response-loss cleanup accepts only all-null evidence', () => {
    const root = makeTemporaryRoot()
    try {
      mkdirSync(requestPaths(root).requestDirectory, { mode: 0o700 })
      const evidence = inspectRequestResidue(root)
      assert.deepEqual(
        {
          nonce: evidence.nonce,
          ownerRawSha256: evidence.ownerRawSha256,
          ownerStageRawSha256: evidence.ownerStageRawSha256,
          payloadRawSha256: evidence.payloadRawSha256,
        },
        { nonce: null, ownerRawSha256: null, ownerStageRawSha256: null, payloadRawSha256: null },
      )
      assert.throws(
        () => cleanRequestResidue(root, { ...evidence, ownerRawSha256: DIGEST_A }),
        (error) => error instanceof InitBacklogError && error.record.code === 'request-evidence-mismatch',
      )
      assert.deepEqual(cleanRequestResidue(root, evidence), { cleaned: true, requestDirectory: REQUEST_GATE_BASENAME })
      assert.deepEqual(cleanRequestResidue(root, evidence), { cleaned: true, requestDirectory: REQUEST_GATE_BASENAME })
      assert.throws(
        () => cleanRequestResidue(root, { ...evidence, nonce: NONCE_A }),
        (error) => error instanceof InitBacklogError && error.record.code === 'request-evidence-mismatch',
      )
    } finally {
      removeTemporaryRoot(root)
    }
  })

  test('fresh reservation preserves malformed residue failure classification', () => {
    const wrongKindRoot = makeTemporaryRoot()
    const extraEntryRoot = makeTemporaryRoot()
    try {
      writeFileSync(requestPaths(wrongKindRoot).requestDirectory, Buffer.alloc(0))
      assert.throws(
        () => reserveRequest(wrongKindRoot, { nonce: NONCE_A }),
        (error) => error instanceof InitBacklogError && error.record.code === 'request-filesystem',
      )

      mkdirSync(requestPaths(extraEntryRoot).requestDirectory, { mode: 0o700 })
      writeFileSync(join(requestPaths(extraEntryRoot).requestDirectory, 'extra'), Buffer.alloc(0))
      assert.throws(
        () => reserveRequest(extraEntryRoot, { nonce: NONCE_A }),
        (error) => error instanceof InitBacklogError && error.record.code === 'request-invalid-state',
      )
    } finally {
      removeTemporaryRoot(wrongKindRoot)
      removeTemporaryRoot(extraEntryRoot)
    }
  })

  test('live and indeterminate consuming owners remain non-cleanable', () => {
    for (const [pidStatus, killProcess] of [
      ['live', () => undefined],
      ['indeterminate', () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }) }],
    ]) {
      const root = makeTemporaryRoot()
      try {
        reserveRequest(root, { nonce: NONCE_A })
        putPayload(root)
        assert.throws(() => consumeRequest(root, NONCE_A, () => undefined, {
          onTransition: (point) => {
            if (point === 'after-consuming-owner-publish') {
              throw new Error('injected crash')
            }
          },
          pid: process.pid,
        }))
        const evidence = inspectRequestResidue(root, { killProcess })
        assert.equal(evidence.pidStatus, pidStatus)
        assert.equal(evidence.cleanupAllowed, false)
        let pidProbeCalled = false
        assert.throws(
          () => cleanRequestResidue(root, { ...evidence, nonce: 'b'.repeat(32) }, { killProcess: () => { pidProbeCalled = true } }),
          (error) => error instanceof InitBacklogError && error.record.code === 'request-evidence-mismatch',
        )
        assert.equal(pidProbeCalled, false)
        assert.throws(() => cleanRequestResidue(root, evidence, { killProcess }), (error) => error instanceof InitBacklogError && error.record.code === 'request-live')
      } finally {
        removeTemporaryRoot(root)
      }
    }
  })

  test('delayed cleanup cannot reinterpret successful consume-and-dispatch gate absence', () => {
    const root = makeTemporaryRoot()
    try {
      reserveRequest(root, { nonce: NONCE_A })
      const reservedEvidence = inspectRequestResidue(root)
      putPayload(root)
      const result = consumeRequest(root, NONCE_A, (bytes) => runPrivateDispatcher(bytes, {
        inspect: () => inspectResult(root),
      }))
      assert.equal(result.exitCode, 0)
      assert.throws(
        () => cleanRequestResidue(root, reservedEvidence),
        (error) => error instanceof InitBacklogError && error.record.code === 'request-evidence-mismatch',
      )
    } finally {
      removeTemporaryRoot(root)
    }
  })

  test('request transport public commands pin argv, records, exits, and stream bytes', () => {
    const root = makeTemporaryRoot()
    try {
      const invalidInvocations = [
        [],
        ['--reserve-request'],
        ['--reserve-request', root, 'extra'],
        ['--consume-request', root, NONCE_A.toUpperCase()],
        ['--consume-request', root, NONCE_A, 'extra'],
        ['--inspect-request-residue', root, 'extra'],
        ['--clean-request-residue', root, 'null', 'null', 'null'],
        ['--clean-request-residue', root, NONCE_A.toUpperCase(), 'null', 'null', 'null'],
        ['--clean-request-residue', root, 'null', DIGEST_A.toUpperCase(), 'null', 'null'],
      ]
      for (const argv of invalidInvocations) {
        const invalidStreams = captureStreams()
        const invalidExit = runCli({ argv, stderr: invalidStreams.stderr, stdout: invalidStreams.stdout })
        assert.equal(invalidExit, 2)
        assert.equal(invalidStreams.stdoutBytes().length, 0)
        assert.deepEqual(invalidStreams.stderrBytes(), Buffer.from('nightshift-init-backlog: invalid request transport invocation\n', 'ascii'))
      }

      const reserveStreams = captureStreams()
      const reserveExit = runCli({ argv: ['--reserve-request', root], nonce: NONCE_A, stderr: reserveStreams.stderr, stdout: reserveStreams.stdout })
      assert.equal(reserveExit, 0)
      assert.equal(reserveStreams.stderrBytes().length, 0)
      const reserveRecord = JSON.parse(reserveStreams.stdoutBytes().toString('utf8'))
      assert.deepEqual(Object.keys(reserveRecord), ['maxRequestBytes', 'nonce', 'requestDirectory', 'requestPath'])
      assert.equal(reserveRecord.maxRequestBytes, MAX_APPLY_REQUEST_BYTES)
      assert.equal(reserveRecord.nonce, NONCE_A)

      const busyStreams = captureStreams()
      const busyExit = runCli({ argv: ['--reserve-request', root], nonce: 'b'.repeat(32), stderr: busyStreams.stderr, stdout: busyStreams.stdout })
      assert.equal(busyExit, 1)
      assert.equal(busyStreams.stderrBytes().length, 0)
      assert.deepEqual(JSON.parse(busyStreams.stdoutBytes().toString('utf8')), { code: 'request-residue', ok: false })

      const inspectStreams = captureStreams()
      const inspectExit = runCli({ argv: ['--inspect-request-residue', root], stderr: inspectStreams.stderr, stdout: inspectStreams.stdout })
      assert.equal(inspectExit, 0)
      const evidence = JSON.parse(inspectStreams.stdoutBytes().toString('utf8'))
      assert.equal(evidence.state, 'reserved')

      const cleanStreams = captureStreams()
      const evidenceArgs = [evidence.nonce, evidence.ownerRawSha256, evidence.ownerStageRawSha256, evidence.payloadRawSha256].map((value) => value === null ? 'null' : value)
      const cleanExit = runCli({ argv: ['--clean-request-residue', root, ...evidenceArgs], stderr: cleanStreams.stderr, stdout: cleanStreams.stdout })
      assert.equal(cleanExit, 0)
      assert.deepEqual(JSON.parse(cleanStreams.stdoutBytes().toString('utf8')), { cleaned: true, requestDirectory: REQUEST_GATE_BASENAME })

      reserveRequest(root, { nonce: NONCE_A })
      putPayload(root)
      const consumeStreams = captureStreams()
      const consumeExit = runCli({
        argv: ['--consume-request', root, NONCE_A],
        dispatch: (bytes) => runPrivateDispatcher(bytes, { inspect: () => inspectResult(root) }),
        stderr: consumeStreams.stderr,
        stdout: consumeStreams.stdout,
      })
      assert.equal(consumeExit, 0)
      assert.equal(consumeStreams.stderrBytes().length, 0)
      assert.deepEqual(consumeStreams.stdoutBytes(), encodeResult(inspectResult(root)))
    } finally {
      removeTemporaryRoot(root)
    }
  })

  test('request transport emits every closed expected refusal record', () => {
    const cases = [
      {
        code: 'request-invalid-state',
        prepare: (root) => ['--inspect-request-residue', root],
      },
      {
        code: 'request-filesystem',
        prepare: (root) => ['--inspect-request-residue', root + require('node:path').sep],
      },
      {
        code: 'request-residue',
        prepare: (root) => {
          reserveRequest(root, { nonce: NONCE_A })

          return ['--reserve-request', root]
        },
      },
      {
        code: 'request-evidence-mismatch',
        prepare: (root) => {
          reserveRequest(root, { nonce: NONCE_A })
          const evidence = inspectRequestResidue(root)

          return ['--clean-request-residue', root, 'b'.repeat(32), evidence.ownerRawSha256, 'null', 'null']
        },
      },
      {
        code: 'request-busy',
        prepare: (root) => {
          reserveRequest(root, { nonce: NONCE_A })
          putPayload(root)
          assert.throws(() => consumeRequest(root, NONCE_A, () => undefined, {
            onTransition: (point) => {
              if (point === 'after-consuming-owner-publish') {
                throw new Error('injected crash')
              }
            },
            pid: process.pid,
          }))

          return ['--reserve-request', root]
        },
      },
      {
        code: 'request-live',
        prepare: (root) => {
          reserveRequest(root, { nonce: NONCE_A })
          putPayload(root)
          assert.throws(() => consumeRequest(root, NONCE_A, () => undefined, {
            onTransition: (point) => {
              if (point === 'after-consuming-owner-publish') {
                throw new Error('injected crash')
              }
            },
            pid: process.pid,
          }))
          const evidence = inspectRequestResidue(root)

          return ['--clean-request-residue', root, evidence.nonce, evidence.ownerRawSha256, 'null', evidence.payloadRawSha256]
        },
      },
    ]
    for (const item of cases) {
      const root = makeTemporaryRoot()
      try {
        const streams = captureStreams()
        const exitCode = runCli({ argv: item.prepare(root), stderr: streams.stderr, stdout: streams.stdout })
        assert.equal(exitCode, 1)
        assert.equal(streams.stderrBytes().length, 0)
        assert.deepEqual(JSON.parse(streams.stdoutBytes().toString('utf8')), { code: item.code, ok: false })
      } finally {
        removeTemporaryRoot(root)
      }
    }
  })

  test('request cleanup failure after mutation uses only the fixed exit-4 transport', () => {
    const root = makeTemporaryRoot()
    try {
      reserveRequest(root, { nonce: NONCE_A })
      const evidence = inspectRequestResidue(root)
      const streams = captureStreams()
      const exitCode = runCli({
        argv: ['--clean-request-residue', root, evidence.nonce, evidence.ownerRawSha256, 'null', 'null'],
        filesystemOptions: { onTransition: (point) => {
          if (point === 'after-owner-remove') {
            throw Object.assign(new Error('injected cleanup failure'), { cleanupFailure: true })
          }
        } },
        stderr: streams.stderr,
        stdout: streams.stdout,
      })
      assert.equal(exitCode, 4)
      assert.equal(streams.stdoutBytes().length, 0)
      assert.deepEqual(streams.stderrBytes(), Buffer.from('nightshift-init-backlog: request transport residue\n', 'ascii'))
    } finally {
      removeTemporaryRoot(root)
    }
  })

  test('private raw dispatcher is unavailable through argv and maps all controller exits', () => {
    const root = canonicalRoot(repositoryRoot)
    const requests = [
      [inspectRequest(root), inspectResult(root), 0],
      [applyRequest(root), applyResult(root), 0],
      [applyRequest(root), { ...applyResult(root), complete: false }, 1],
      [recoveryInspectRequest(root), recoveryInspectResult(root), 0],
      [recoveryApplyRequest(root), recoveryApplyResult(root), 0],
      [inspectRequest(root), { ...failureResult(), code: 'filesystem', operation: 'inspect', phase: 'inspect' }, 1],
      [inspectRequest(root), failureResult(), 2],
    ]
    for (const [request, result, expectedExit] of requests) {
      const dispatched = runPrivateDispatcher(Buffer.from(canonicalJson(request) + '\n', 'utf8'), { [request.operation]: () => result })
      assert.equal(dispatched.exitCode, expectedExit)
      assert.equal(dispatched.stderr.length, 0)
      assert.deepEqual(dispatched.stdout, encodeResult(result))
    }

    const internal = runPrivateDispatcher(Buffer.from(canonicalJson(inspectRequest(root)) + '\n', 'utf8'), { inspect: () => { throw new Error('unexpected') } })
    assert.equal(internal.exitCode, 3)
    assert.equal(internal.stdout.length, 0)
    assert.deepEqual(internal.stderr, Buffer.from('nightshift-init-backlog: internal process failure\n', 'ascii'))

    const oversized = inspectResult(root)
    oversized.ready = { detail: 'x'.repeat(MAX_INSPECT_RESULT_BYTES) }
    const overflow = runPrivateDispatcher(Buffer.from(canonicalJson(inspectRequest(root)) + '\n', 'utf8'), { inspect: () => oversized })
    assert.equal(overflow.exitCode, 3)
    assert.equal(overflow.stdout.length, 0)
    assert.deepEqual(overflow.stderr, Buffer.from('nightshift-init-backlog: internal process failure\n', 'ascii'))
  })

  test('request gate mode evidence follows platform semantics', () => {
    const root = makeTemporaryRoot()
    try {
      reserveRequest(root, { nonce: NONCE_A })
      const evidence = inspectRequestResidue(root)
      if (process.platform === 'win32') {
        assert.equal(evidence.mode, undefined)
        assert.equal(evidence.ownerMode, undefined)
      } else {
        assert.equal(statSync(requestPaths(root).requestDirectory).mode & 0o7777, 0o700)
        assert.equal(statSync(requestPaths(root).owner).mode & 0o7777, 0o600)
      }
      cleanRequestResidue(root, evidence)
    } finally {
      removeTemporaryRoot(root)
    }
  })

  test('recovery result paths use code-point ordinal ordering for non-BMP values', () => {
    const result = recoveryApplyResult(join(tmpdir(), 'nightshift-recovery-result-root'))
    const bmp = 'a/\uE000'
    const nonBmp = 'a/\u{1F600}'
    result.changedPaths = [bmp, nonBmp]
    result.retainedPaths = [bmp, nonBmp]
    assert.doesNotThrow(() => validateResultRecord(result))
    result.changedPaths = [nonBmp, bmp]
    assert.throws(() => validateResultRecord(result), /ordinal|sorted/i)
    result.changedPaths = [bmp, nonBmp]
    result.retainedPaths = [nonBmp, bmp]
    assert.throws(() => validateResultRecord(result), /ordinal|sorted/i)
  })

  test('concurrent reservations serialize on one fixed gate pathname', async () => {
    const root = makeTemporaryRoot()
    const scriptPath = join(repositoryRoot, 'skills', 'init-backlog', 'init-backlog.js')
    try {
      const results = await Promise.all([
        runChild(scriptPath, ['--reserve-request', root]),
        runChild(scriptPath, ['--reserve-request', root]),
      ])
      assert.deepEqual(results.map((result) => result.exitCode).sort(), [0, 1])
      assert.equal(readdirSync(root).filter((name) => name === REQUEST_GATE_BASENAME).length, 1)
      const evidence = inspectRequestResidue(root)
      cleanRequestResidue(root, evidence)
    } finally {
      removeTemporaryRoot(root)
    }
  })
}

module.exports = { runProtocolCases }
