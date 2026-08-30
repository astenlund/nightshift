'use strict'

const assert = require('node:assert/strict')
const { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

const { publishApply, publishRecoveryFile, recoveryTemporaryTarget } = require('../../skills/init-backlog/lib/publication')
const { applyRecovery, inspectRecovery } = require('../../skills/init-backlog/lib/recovery')
const { createOwnerInventoryIndex, validateOwnerInventoryStates } = require('../../skills/init-backlog/lib/owner-inventory')
const { admitApplyManifest } = require('../../skills/init-backlog/lib/apply-manifest')
const { InitBacklogError, failureRecord } = require('../../skills/init-backlog/lib/errors')
const { runPrivateDispatcher } = require('../../skills/init-backlog/init-backlog')
const { MAX_INLINE_FILE_BYTES, MAX_MECHANICAL_FILE_BYTES, MAX_RECOVERY_REQUEST_BYTES, backupFileNames, canonicalBytes, canonicalJson, compareOrdinal, deriveRecoveryId, deriveSnapshotId, encodeResult, sha256, validateResultRecord } = require('../../skills/init-backlog/lib/protocol')
const { stableOpenFile } = require('../../skills/init-backlog/lib/filesystem')
const { discoverInitialLockStages, inspect } = require('../../skills/init-backlog/lib/inspection')
const { unwrapText } = require('../../skills/init-backlog/unwrap')
const { ELECTION_MARKER_PATH } = require('./election-oracles')

// Independent oracle pin: the recovery gate basename is spelled out here on purpose
// and is deliberately not imported from the production constant it verifies.
const RECOVERY_GATE = '.nightshift-init-backlog.recovery-gate'

function fixtureRoot() {
  return mkdtempSync(join(tmpdir(), 'nightshift-init-backlog-recovery-'))
}

function hostContext() {
  return { claudeContextSource: 'host-observed', claudeRootExclusionStatus: 'included', codexContextSource: null, codexInvocationDirectory: null, codexProjectDocMaxBytes: null, codexProjectInstructions: [] }
}

function request(root, kind, target) {
  return { host: 'claude-code', hostContext: hostContext(), operation: 'recover-inspect', protocolVersion: 1, recoveryKind: kind, recoveryTarget: target, root }
}

function recoveryApplyEnvelope(requestValue, inspection, disposition) {
  return { disposition, host: requestValue.host, hostContext: requestValue.hostContext, operation: 'recover-apply', protocolVersion: 1, recoveryInspection: inspection, root: requestValue.root }
}

function codexContext(instructions = []) {
  return { claudeContextSource: null, claudeRootExclusionStatus: null, codexContextSource: 'user-confirmed', codexInvocationDirectory: '.', codexProjectDocMaxBytes: 65536, codexProjectInstructions: instructions }
}

function absentPid() {
  return () => { const error = new Error('absent'); error.code = 'ESRCH'; throw error }
}

function writeCanonical(path, value, mode = 0o600) {
  writeFileSync(path, Buffer.from(`${canonicalJson(value)}\n`, 'utf8'), { mode })
}

function causeChainHasCode(error, code) {
  for (let current = error; current !== undefined; current = current.cause) {
    if (current?.code === code) return true
  }

  return false
}

function backupFixture(target = 'FEATURES.md', backupByte = 'backup\n', currentByte = 'current\n') {
  const root = fixtureRoot()
  mkdirSync(join(root, '.tmp'), { mode: 0o700 })
  const targetHash = sha256(Buffer.from(target, 'utf8'))
  const backupTarget = `.tmp/nightshift-init-backlog-unwrap-${'a'.repeat(64)}-${'b'.repeat(64)}-${targetHash}.bak`
  writeFileSync(join(root, target), Buffer.from(currentByte, 'utf8'), { mode: 0o644 })
  writeFileSync(join(root, ...backupTarget.split('/')), Buffer.from(backupByte, 'utf8'), { mode: 0o600 })

  return { backupTarget, root, target }
}

function backupInspection(fixture) {
  return inspectRecovery(request(fixture.root, 'abandoned-backup', fixture.backupTarget), { currentInspection: { targets: [{ target: fixture.target }] } })
}

function rekeyRecoveryInspection(inspection, overrides) {
  const updated = { ...inspection, ...overrides, recoveryId: null }
  updated.recoveryId = deriveRecoveryId(updated)

  return updated
}

function markerFixture() {
  const root = fixtureRoot()
  const marker = ELECTION_MARKER_PATH
  writeCanonical(join(root, marker), { invalid: true })

  return { marker, root }
}

function stageFixture(root, pid = 123, nonce = 'a'.repeat(32), bytes = null) {
  const target = `.nightshift-init-backlog.lock.${pid}.${nonce}.new`
  writeFileSync(join(root, target), bytes ?? Buffer.from(`${canonicalJson({ ownerNonce: nonce, pid, protocolVersion: 1 })}\n`, 'utf8'), { mode: 0o600 })

  return target
}

function ownerFixture(root, overrides = {}) {
  const mode = process.platform === 'win32' ? null : 0o700
  const lock = { createdAtUnixMs: 0, manifestId: 'a'.repeat(64), operation: 'apply', ownerNonce: 'b'.repeat(32), pid: 321, protocolVersion: 1, recoveryId: null, root, temporaryPaths: [], unfinalizedDirectories: [], ...overrides }
  writeCanonical(join(root, '.nightshift-init-backlog.lock'), lock)

  return { lock, mode }
}

function gateOwner(root, pid = 321) {
  return { createdAtUnixMs: 0, manifestId: null, operation: 'recover-apply', ownerNonce: 'c'.repeat(32), pid, protocolVersion: 1, recoveryId: 'd'.repeat(64), root, temporaryPaths: [], unfinalizedDirectories: [] }
}

function unwrapFixture(count = 1) {
  const root = fixtureRoot()
  const targets = []
  const actions = []
  const wrapFindings = []
  const proposals = []
  for (let index = 0; index < count; index += 1) {
    const target = `FEATURES-${index}.md`
    const wrapped = Buffer.from(`# Header ${index}\n\nparagraph first\nparagraph continuation\n`, 'utf8')
    const after = Buffer.from(unwrapText(wrapped.toString('utf8')), 'utf8')
    const action = { afterRawSha256: sha256(after), beforeRawSha256: sha256(wrapped), id: `unwrap-${index}`, kind: 'unwrap-file', mode: process.platform === 'win32' ? null : 0o644, target }
    writeFileSync(join(root, target), wrapped, { mode: 0o644 })
    targets.push({ bom: null, cleanTextSha256: null, contentBase64: wrapped.toString('base64'), contentRole: 'mechanical', editableRegions: [], finalNewline: true, kind: 'file', mode: action.mode, newline: 'lf', rawSha256: action.beforeRawSha256, states: ['wrapped'], target, templateId: null, templateSha256: null })
    actions.push(action)
    wrapFindings.push({ beforeRawSha256: action.beforeRawSha256, predictedContentBase64: null, predictedEditableRegions: [], predictedRawSha256: action.afterRawSha256, target })
    proposals.push({ action, afterBase64: null, beforeBase64: null, condition: 'always', proposalId: action.id, reason: 'hard-wrap' })
  }
  const carried = {
    git: { electionMarker: 'absent', electionMarkerMode: null, electionMarkerSnapshotId: null, electionRequired: false, freshScaffold: false, kind: 'non-git', newlinePolicies: [], nonPlanIgnoreMatches: [], nonPlanUnignoredPaths: [], objectFormat: null, plansPolicy: 'not-applicable', trackedBacklogPaths: [], trackedPlanPaths: [] },
    guidance: { baseAdapter: null, candidates: [], graphPaths: [], imports: [], independentPaths: [], resolvedTarget: 'AGENTS.md' },
    host: 'claude-code', hostContext: hostContext(), ok: true, operation: 'inspect', problems: [], proposals, protocolVersion: 1, ready: { blocked: [], external: [], found: [], indexes: { found: [], missing: [] }, ready: [] }, retainedBackups: [], root, snapshotId: null, targets, templates: [], unwrapReady: { after: { blocked: [], external: [], found: [], indexes: { found: [], missing: [] }, ready: [] }, targets }, warnings: [], wrapFindings,
  }
  carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
  const post = { ...carried, snapshotId: null, targets: targets.map((target) => ({ ...target, states: [] })), wrapFindings: [] }
  post.snapshotId = deriveSnapshotId({ ...post, snapshotId: null })
  const applyRequest = { actions, host: 'claude-code', hostContext: carried.hostContext, inspection: carried, operation: 'apply', proposalDispositions: actions.map((action) => ({ disposition: 'selected', proposalId: action.id })), protocolVersion: 1, root, semanticDecisions: [], versionControlChoice: 'not-required' }

  return { actions, applyRequest, carried, post, root, targets }
}

function runRecoveryCases() {
  test('evidence-first recovery exports the two recovery operations', () => {
    assert.equal(typeof inspectRecovery, 'function')
    assert.equal(typeof applyRecovery, 'function')
  })

  test('owner inventory indexing and state validation visit inventory linearly', () => {
    const pairCount = 256
    const manifestId = 'a'.repeat(64)
    const snapshotId = 'b'.repeat(64)
    const paths = []
    for (let index = 0; index < pairCount; index += 1) {
      const names = backupFileNames(snapshotId, manifestId, index.toString(16).padStart(64, '0'))
      paths.push(names.stage, names.final)
    }
    let indexedReads = 0
    const countReads = (items) => new Proxy(items, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^(0|[1-9][0-9]*)$/.test(property)) indexedReads += 1

        return Reflect.get(target, property, receiver)
      },
    })
    const inventory = createOwnerInventoryIndex(countReads(paths))
    const states = countReads(paths.map((target) => ({ present: true, target })))

    validateOwnerInventoryStates({ manifestId, ownerNonce: 'c'.repeat(32), pid: 321 }, inventory, states, [], () => false)

    assert.ok(indexedReads <= paths.length * 4, `expected at most ${paths.length * 4} indexed reads, received ${indexedReads}`)
  })

  test('unwrap publication rejects a symlinked root temporary directory before any outside write', () => {
    if (process.platform === 'win32') return
    const fixture = unwrapFixture(1)
    const external = fixtureRoot()
    try {
      rmSync(join(fixture.root, '.tmp'), { recursive: true, force: true })
      symlinkSync(external, join(fixture.root, '.tmp'))
      assert.throws(() => publishApply(fixture.applyRequest, { currentInspection: fixture.carried, collectInspection: () => fixture.post }), /backup|ordinary|confined|filesystem/i)
      assert.deepEqual(require('node:fs').readdirSync(external), [])
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
      rmSync(external, { force: true, recursive: true })
    }
  })

  test('subject recovery is blocked by an unrelated ordinary lock before evidence collection', () => {
    const fixture = backupFixture()
    try {
      writeFileSync(join(fixture.root, '.nightshift-init-backlog.lock'), Buffer.from('unrelated\n', 'utf8'), { mode: 0o600 })
      assert.throws(() => inspectRecovery(request(fixture.root, 'abandoned-backup', fixture.backupTarget), { currentInspection: { targets: [{ target: fixture.target }] } }), /lock|coordination|runtime/i)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('orphan-stage, election-marker, and abandoned-backup recovery all block on an unrelated gate', () => {
    const cases = [
      () => {
        const root = fixtureRoot()
        const target = stageFixture(root)
        return { request: request(root, 'orphan-lock-stage', target), options: { killProcess: absentPid() }, root }
      },
      () => {
        const root = fixtureRoot()
        writeFileSync(join(root, ELECTION_MARKER_PATH), Buffer.from('partial\n', 'utf8'), { mode: 0o600 })
        return { request: request(root, 'election-marker', ELECTION_MARKER_PATH), options: { currentInspection: { git: { kind: 'git' } } }, root }
      },
      () => {
        const fixture = backupFixture()
        return { request: request(fixture.root, 'abandoned-backup', fixture.backupTarget), options: { currentInspection: { targets: [{ target: fixture.target }] } }, root: fixture.root }
      },
    ]
    for (const makeCase of cases) {
      const item = makeCase()
      try {
        mkdirSync(join(item.root, RECOVERY_GATE), { mode: 0o700 })
        assert.throws(() => inspectRecovery(item.request, item.options), /lock|coordination|runtime|gate/i)
      } finally {
        rmSync(item.root, { force: true, recursive: true })
      }
    }
  })

  test('orphan lock-stage inspection returns bounded malformed-stage evidence without parsing authority', () => {
    const root = fixtureRoot()
    try {
      const target = `.nightshift-init-backlog.lock.123.${'a'.repeat(32)}.new`
      writeFileSync(join(root, target), Buffer.from('partial', 'utf8'), { mode: 0o600 })
      const result = inspectRecovery(request(root, 'orphan-lock-stage', target), { killProcess: absentPid() })

      assert.equal(result.ok, true)
      assert.equal(result.recoveryKind, 'orphan-lock-stage')
      assert.deepEqual(result.allowedDispositions, ['remove'])
      assert.equal(result.evidence.lockStage.record, null)
      assert.equal(result.evidence.lockStage.pidStatus, 'absent')
      assert.equal(result.evidence.owner, null)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('malformed final lock and recovery gate return the exact runtime-lock carrier', () => {
    const lockFixtures = [
      (root) => writeFileSync(join(root, '.nightshift-init-backlog.lock'), Buffer.from('malformed\n', 'utf8'), { mode: 0o600 }),
      (root) => mkdirSync(join(root, '.nightshift-init-backlog.lock'), { mode: 0o700 }),
      (root) => { writeFileSync(join(root, 'lock-source'), Buffer.from('lock\n', 'utf8'), { mode: 0o600 }); linkSync(join(root, 'lock-source'), join(root, '.nightshift-init-backlog.lock')) },
    ]
    for (const createLock of lockFixtures) {
      const lockRoot = fixtureRoot()
      try {
        createLock(lockRoot)
        assert.throws(() => inspectRecovery(request(lockRoot, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() }), (error) => error.record?.code === 'runtime-lock' && error.record.phase === 'lock' && error.record.target === '.nightshift-init-backlog.lock' && error.record.operation === 'recover-inspect')
      } finally {
        rmSync(lockRoot, { force: true, recursive: true })
      }
    }

    const gateFixtures = [
      (gate) => { writeFileSync(join(gate, 'owner.new'), Buffer.from('malformed\n', 'utf8'), { mode: 0o600 }); linkSync(join(gate, 'owner.new'), join(gate, 'owner.json')) },
      (gate) => { rmSync(gate, { force: true, recursive: true }); writeFileSync(gate, Buffer.from('not a gate\n', 'utf8'), { mode: 0o600 }) },
      (gate) => { writeFileSync(join(gate, 'owner.new'), Buffer.from('stage\n', 'utf8'), { mode: 0o600 }); linkSync(join(gate, 'owner.new'), join(gate, 'extra')) },
    ]
    for (const createGateResidue of gateFixtures) {
      const gateRoot = fixtureRoot()
      try {
        const gate = join(gateRoot, RECOVERY_GATE)
        mkdirSync(gate, { mode: 0o700 })
        createGateResidue(gate)
        assert.throws(() => inspectRecovery(request(gateRoot, 'stale-recovery-gate', RECOVERY_GATE), { killProcess: absentPid() }), (error) => error.record?.code === 'runtime-lock' && error.record.phase === 'lock' && error.record.target === RECOVERY_GATE && error.record.operation === 'recover-inspect')
      } finally {
        rmSync(gateRoot, { force: true, recursive: true })
      }
    }
  })

  test('stale owner bounds the publication lock before reading its bytes', () => {
    const root = fixtureRoot()
    let observedMaxBytes = null
    try {
      writeFileSync(join(root, '.nightshift-init-backlog.lock'), Buffer.alloc(MAX_RECOVERY_REQUEST_BYTES + 1, 0x61), { mode: 0o600 })

      assert.throws(() => inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), {
        killProcess: absentPid(),
        stableOpenFile: (candidateRoot, target, options) => {
          observedMaxBytes = options.maxBytes

          return stableOpenFile(candidateRoot, target, options)
        },
      }), (error) => error.record?.code === 'runtime-lock' && error.record.phase === 'lock' && error.record.target === '.nightshift-init-backlog.lock')
      assert.equal(observedMaxBytes, MAX_RECOVERY_REQUEST_BYTES)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('stale owner bounds inventoried file bytes at the mechanical ceiling', () => {
    for (const extraBytes of [0, 1]) {
      const root = fixtureRoot()
      const manifestId = 'a'.repeat(64)
      const target = `.nightshift-init-backlog.${manifestId}.1.tmp`
      try {
        writeCanonical(join(root, '.nightshift-init-backlog.lock'), { createdAtUnixMs: 0, manifestId, operation: 'apply', ownerNonce: 'b'.repeat(32), pid: 321, protocolVersion: 1, recoveryId: null, root, temporaryPaths: [target], unfinalizedDirectories: [] })
        writeFileSync(join(root, target), Buffer.alloc(MAX_MECHANICAL_FILE_BYTES + extraBytes, 0x61), { mode: 0o600 })

        if (extraBytes === 0) {
          const inspected = inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
          assert.equal(inspected.evidence.owner.temporaryStates[0].present, true)
        } else {
          assert.throws(() => inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() }), (error) => error.record?.code === 'runtime-lock')
        }
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    }
  })

  test('stale owner inspection carries inventory and cleanup removes only unchanged residue', () => {
    const root = fixtureRoot()
    try {
      const nonce = 'b'.repeat(32)
      const temporary = `.nightshift-init-backlog.${'c'.repeat(64)}.1.tmp`
      const lock = { createdAtUnixMs: 0, manifestId: 'c'.repeat(64), operation: 'apply', ownerNonce: nonce, pid: 321, protocolVersion: 1, recoveryId: null, root, temporaryPaths: [temporary], unfinalizedDirectories: [] }
      writeCanonical(join(root, '.nightshift-init-backlog.lock'), lock)
      writeFileSync(join(root, temporary), Buffer.from('temp', 'utf8'), { mode: 0o600 })
      const inspected = inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
      assert.deepEqual(inspected.allowedDispositions, ['cleanup'])
      assert.equal(inspected.evidence.owner.pidStatus, 'absent')
      assert.equal(inspected.evidence.owner.temporaryStates[0].present, true)
      const applied = applyRecovery({ ...request(root, 'stale-owner', '.nightshift-init-backlog.lock'), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'cleanup' }, { killProcess: absentPid() })

      assert.equal(applied.status, 'completed')
      assert.deepEqual(applied.changedPaths, ['.nightshift-init-backlog.lock', temporary].sort(compareOrdinal))
      assert.equal(statSync(root).isDirectory(), true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('stale owner accepts only exactly derived temporary names', () => {
    const manifestId = 'c'.repeat(64)
    const nonce = 'b'.repeat(32)
    const snapshotId = 'a'.repeat(64)
    const targetHash = sha256(Buffer.from('.claude/FEATURES.md', 'utf8'))
    const names = [
      `.nightshift-init-backlog.lock.321.${nonce}.new`,
      `.nightshift-init-backlog.lock.${nonce}.next`,
      `.nightshift-init-backlog.${manifestId}.1.tmp`,
      `.claude/.nightshift-init-backlog.${manifestId}.2.tmp`,
      `.claude/.nightshift-init-backlog.${manifestId}.${targetHash}.tmp`,
      `${ELECTION_MARKER_PATH}.${manifestId}.tmp`,
      `${ELECTION_MARKER_PATH}.${manifestId}.new.tmp`,
      `${ELECTION_MARKER_PATH}.${manifestId}.old.tmp`,
      `${ELECTION_MARKER_PATH}.${manifestId}.tombstone.tmp`,
      `.tmp/.nightshift-init-backlog-unwrap-${snapshotId}-${manifestId}-${targetHash}.tmp`,
      `.tmp/nightshift-init-backlog-unwrap-${snapshotId}-${manifestId}-${targetHash}.bak`,
    ].sort(compareOrdinal)
    for (const name of names) {
      const root = fixtureRoot()
      try {
        mkdirSync(join(root, '.claude'), { mode: 0o700 })
        mkdirSync(join(root, '.tmp'), { mode: 0o700 })
        const backup = `.tmp/nightshift-init-backlog-unwrap-${snapshotId}-${manifestId}-${targetHash}.bak`
        const temporaryPaths = name.includes(targetHash) && !name.endsWith('.bak') ? [name, backup].sort(compareOrdinal) : [name]
        const record = { createdAtUnixMs: 0, manifestId, operation: 'apply', ownerNonce: nonce, pid: 321, protocolVersion: 1, recoveryId: null, root, temporaryPaths, unfinalizedDirectories: [] }
        writeCanonical(join(root, '.nightshift-init-backlog.lock'), record)
        if (name === `.nightshift-init-backlog.lock.321.${nonce}.new`) {
          linkSync(join(root, '.nightshift-init-backlog.lock'), join(root, name))
        } else {
          writeFileSync(join(root, ...name.split('/')), Buffer.from(name, 'utf8'), { mode: 0o600 })
        }
        const inspected = inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
        const state = inspected.evidence.owner.temporaryStates.find((item) => item.target === name)
        assert.notEqual(state, undefined)
        assert.equal(state.present, true)
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    }
    const root = fixtureRoot()
    try {
      const forged = { createdAtUnixMs: 0, manifestId, operation: 'apply', ownerNonce: nonce, pid: 321, protocolVersion: 1, recoveryId: null, root, temporaryPaths: ['.nightshift-init-backlog.owner.tmp'], unfinalizedDirectories: [] }
      writeCanonical(join(root, '.nightshift-init-backlog.lock'), forged)
      assert.throws(() => inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() }), /malformed|inventory|temporary/i)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('stale-owner cleanup accepts an earlier removed temporary while retaining and then removing later inventory entries, but rejects the opposite gap', () => {
    const makeFixture = () => {
      const root = fixtureRoot()
      const nonce = 'b'.repeat(32)
      const first = `.nightshift-init-backlog.${'c'.repeat(64)}.1.tmp`
      const second = `.nightshift-init-backlog.${'c'.repeat(64)}.2.tmp`
      writeCanonical(join(root, '.nightshift-init-backlog.lock'), { createdAtUnixMs: 0, manifestId: 'c'.repeat(64), operation: 'apply', ownerNonce: nonce, pid: 321, protocolVersion: 1, recoveryId: null, root, temporaryPaths: [first, second], unfinalizedDirectories: [] })
      writeFileSync(join(root, first), Buffer.from('first', 'utf8'), { mode: 0o600 })
      writeFileSync(join(root, second), Buffer.from('second', 'utf8'), { mode: 0o600 })
      return { first, root, second }
    }
    const valid = makeFixture()
    try {
      const inspected = inspectRecovery(request(valid.root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
      rmSync(join(valid.root, valid.first))
      rmSync(join(valid.root, '.nightshift-init-backlog.lock'))
      let applied
      try {
        applied = applyRecovery({ ...request(valid.root, 'stale-owner', '.nightshift-init-backlog.lock'), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'cleanup' }, { killProcess: absentPid() })
      } catch (error) { throw error }
      assert.equal(applied.status, 'completed')
      assert.equal(existsSync(join(valid.root, valid.second)), false)
    } finally {
      rmSync(valid.root, { force: true, recursive: true })
    }
    const invalid = makeFixture()
    try {
      const inspected = inspectRecovery(request(invalid.root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
      rmSync(join(invalid.root, invalid.second))
      assert.throws(() => applyRecovery({ ...request(invalid.root, 'stale-owner', '.nightshift-init-backlog.lock'), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'cleanup' }, { killProcess: absentPid() }), /contiguous|snapshot|changed|publication failed/i)
      assert.equal(existsSync(join(invalid.root, invalid.first)), true)
    } finally {
      rmSync(invalid.root, { force: true, recursive: true })
    }
  })

  test('lock-absent stale-owner replay rejects a forged confined temporary outside the owner inventory', () => {
    const root = fixtureRoot()
    try {
      const recorded = `.nightshift-init-backlog.${'c'.repeat(64)}.1.tmp`
      const forged = '.nightshift-init-backlog-forged.tmp'
      const nonce = 'b'.repeat(32)
      writeCanonical(join(root, '.nightshift-init-backlog.lock'), { createdAtUnixMs: 0, manifestId: 'c'.repeat(64), operation: 'apply', ownerNonce: nonce, pid: 321, protocolVersion: 1, recoveryId: null, root, temporaryPaths: [recorded], unfinalizedDirectories: [] })
      writeFileSync(join(root, recorded), Buffer.from('recorded', 'utf8'), { mode: 0o600 })
      writeFileSync(join(root, forged), Buffer.from('forged', 'utf8'), { mode: 0o600 })
      const inspected = inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
      rmSync(join(root, '.nightshift-init-backlog.lock'))
      const forgedOwner = { ...inspected.evidence.owner, temporaryStates: [...inspected.evidence.owner.temporaryStates, { mode: process.platform === 'win32' ? null : 0o600, present: true, rawSha256: sha256(Buffer.from('forged', 'utf8')), target: forged }] }
      const forgedInspection = rekeyRecoveryInspection(inspected, { evidence: { ...inspected.evidence, owner: forgedOwner } })

      assert.throws(
        () => applyRecovery({ ...request(root, 'stale-owner', '.nightshift-init-backlog.lock'), operation: 'recover-apply', recoveryInspection: forgedInspection, disposition: 'cleanup' }, { killProcess: absentPid() }),
        (error) => error.record?.code === 'snapshot-drift',
      )
      assert.equal(existsSync(join(root, recorded)), true)
      assert.equal(existsSync(join(root, forged)), true)
      assert.equal(existsSync(join(root, RECOVERY_GATE)), false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('stale-owner cleanup retains only present validated backups and excludes them from changed paths', () => {
    const root = fixtureRoot()
    try {
      const manifestId = 'c'.repeat(64)
      const backup = `.tmp/nightshift-init-backlog-unwrap-${'a'.repeat(64)}-${manifestId}-${sha256(Buffer.from('FEATURES.md', 'utf8'))}.bak`
      const missingBackup = `.tmp/nightshift-init-backlog-unwrap-${'b'.repeat(64)}-${manifestId}-${sha256(Buffer.from('BUGS.md', 'utf8'))}.bak`
      const temporary = `.nightshift-init-backlog.${manifestId}.1.tmp`
      mkdirSync(join(root, '.tmp'), { mode: 0o700 })
      writeFileSync(join(root, temporary), Buffer.from('temporary', 'utf8'), { mode: 0o600 })
      writeFileSync(join(root, ...backup.split('/')), Buffer.from('backup', 'utf8'), { mode: 0o600 })
      writeCanonical(join(root, '.nightshift-init-backlog.lock'), { createdAtUnixMs: 0, manifestId, operation: 'apply', ownerNonce: 'b'.repeat(32), pid: 321, protocolVersion: 1, recoveryId: null, root, temporaryPaths: [temporary, backup, missingBackup], unfinalizedDirectories: [] })
      const inspected = inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
      const applied = applyRecovery({ ...request(root, 'stale-owner', '.nightshift-init-backlog.lock'), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'cleanup' }, { killProcess: absentPid() })

      assert.deepEqual(applied.changedPaths, ['.nightshift-init-backlog.lock', temporary].sort(compareOrdinal))
      assert.deepEqual(applied.retainedPaths, [backup])
      assert.equal(existsSync(join(root, ...backup.split('/'))), true)
      assert.equal(existsSync(join(root, ...missingBackup.split('/'))), false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('lock-absent stale-owner replay revalidates every carried directory before claiming the recovery gate', () => {
    const root = fixtureRoot()
    try {
      const target = '.nightshift-init-backlog-dir.tmp'
      ownerFixture(root, { unfinalizedDirectories: [{ mode: process.platform === 'win32' ? null : 0o700, target }] })
      const inspected = inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
      rmSync(join(root, '.nightshift-init-backlog.lock'))
      writeFileSync(join(root, target), Buffer.from('unexpected file', 'utf8'), { mode: 0o600 })

      assert.throws(
        () => applyRecovery({ ...request(root, 'stale-owner', '.nightshift-init-backlog.lock'), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'cleanup' }, { killProcess: absentPid() }),
        (error) => error.record?.code === 'snapshot-drift',
      )
      assert.equal(existsSync(join(root, target)), true)
      assert.equal(existsSync(join(root, RECOVERY_GATE)), false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('recovery apply rejects a forged allowed disposition derived from non-Git marker evidence', () => {
    const fixture = markerFixture()
    try {
      const currentInspection = { git: { kind: 'non-git', freshScaffold: false } }
      const inspected = inspectRecovery(request(fixture.root, 'election-marker', fixture.marker), { currentInspection })
      const forged = rekeyRecoveryInspection(inspected, { allowedDispositions: ['deferred'] })
      const before = readFileSync(join(fixture.root, fixture.marker))

      assert.throws(
        () => applyRecovery({ ...request(fixture.root, 'election-marker', fixture.marker), operation: 'recover-apply', recoveryInspection: forged, disposition: 'deferred' }, { currentInspection }),
        (error) => error.record?.code === 'snapshot-drift',
      )
      assert.deepEqual(readFileSync(join(fixture.root, fixture.marker)), before)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('redundant-backup removal reports the matched current target as retained', () => {
    const fixture = backupFixture('FEATURES.md', 'same\n', 'same\n')
    try {
      const inspected = backupInspection(fixture)
      const applied = applyRecovery({ ...request(fixture.root, 'abandoned-backup', fixture.backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'remove' })

      assert.deepEqual(applied.changedPaths, [fixture.backupTarget])
      assert.deepEqual(applied.retainedPaths, [fixture.target])
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('stale-owner cleanup retries after lock, gate-owner, empty-gate, and gate removal with deterministic completion', () => {
    for (const state of ['lock-removed', 'owner-removed', 'empty-gate', 'gate-removed']) {
      const root = fixtureRoot()
      try {
        const { lock } = ownerFixture(root)
        const inspected = inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
        const gate = join(root, RECOVERY_GATE)
        mkdirSync(gate, { mode: 0o700 })
        if (state === 'lock-removed' || state === 'owner-removed') writeCanonical(join(gate, 'owner.json'), { ...gateOwner(root), recoveryId: inspected.recoveryId })
        if (state !== 'gate-removed') rmSync(join(root, '.nightshift-init-backlog.lock'), { force: true })
        if (state === 'owner-removed') rmSync(join(gate, 'owner.json'), { force: true })
        if (state === 'empty-gate') rmSync(join(root, '.nightshift-init-backlog.lock'), { force: true })
        if (state === 'gate-removed') rmSync(join(root, '.nightshift-init-backlog.lock'), { force: true })
        if (state === 'gate-removed') rmSync(gate, { force: true, recursive: true })
        const result = applyRecovery({ ...request(root, 'stale-owner', '.nightshift-init-backlog.lock'), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'cleanup' }, { killProcess: absentPid() })
        assert.ok(['completed', 'already-complete'].includes(result.status), `${state}: ${result.status}`)
        void lock
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    }
  })

  test('stale-owner recovery gate reuse gives one interleaved claimant exclusive ownership', () => {
    const root = fixtureRoot()
    try {
      ownerFixture(root)
      const inspection = inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
      const gate = join(root, RECOVERY_GATE)
      mkdirSync(gate, { mode: 0o700 })
      writeCanonical(join(gate, 'owner.json'), { ...gateOwner(root), recoveryId: inspection.recoveryId })
      const applyRequest = recoveryApplyEnvelope(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), inspection, 'cleanup')
      let loser = null
      let transitionObserved = false
      const winner = applyRecovery(applyRequest, {
        killProcess: absentPid(),
        onTransition: (point) => {
          if (point !== 'after-recovery-gate-reuse-claim') return

          transitionObserved = true
          assert.deepEqual(readdirSync(gate).sort(), ['owner.json', 'owner.new'])
          assert.equal(statSync(join(gate, 'owner.json')).nlink, 2)
          assert.equal(statSync(join(gate, 'owner.new')).nlink, 2)
          loser = runPrivateDispatcher(Buffer.from(`${canonicalJson(applyRequest)}\n`, 'utf8'), { 'recover-apply': (value) => applyRecovery(value, { killProcess: absentPid() }) })
          assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), true)
          assert.deepEqual(readdirSync(gate).sort(), ['owner.json', 'owner.new'])
        },
      })
      assert.equal(transitionObserved, true)
      const loserRecord = JSON.parse(loser.stdout.toString('utf8'))

      assert.equal(winner.status, 'completed')
      assert.equal(loser.exitCode, 1, loser.stdout.toString('utf8'))
      assert.equal(loserRecord.code, 'runtime-lock')
      assert.equal(loserRecord.phase, 'lock')
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), false)
      assert.equal(existsSync(gate), false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('stale recovery gate cleanup removes stage before owner and gate', () => {
    const root = fixtureRoot()
    try {
      const gate = join(root, RECOVERY_GATE)
      mkdirSync(gate, { mode: 0o700 })
      if (process.platform !== 'win32') chmodSync(gate, 0o700)
      writeFileSync(join(gate, 'owner.new'), Buffer.from('partial', 'utf8'), { mode: 0o600 })
      const inspected = inspectRecovery(request(root, 'stale-recovery-gate', RECOVERY_GATE), { killProcess: absentPid() })
      assert.deepEqual(inspected.allowedDispositions, ['cleanup'])
      const applied = applyRecovery({ ...request(root, 'stale-recovery-gate', RECOVERY_GATE), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'cleanup' }, { killProcess: absentPid() })

      assert.equal(applied.status, 'completed')
      assert.equal(statSync(root).isDirectory(), true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('stale recovery gate rejects a rogue child without removing any gate state', () => {
    const root = fixtureRoot()
    try {
      const gate = join(root, RECOVERY_GATE)
      mkdirSync(gate, { mode: 0o700 })
      const inspected = inspectRecovery(request(root, 'stale-recovery-gate', RECOVERY_GATE), { killProcess: absentPid() })
      const rogue = join(gate, 'rogue')
      writeFileSync(rogue, Buffer.from('rogue', 'utf8'), { mode: 0o600 })
      const applyRequest = recoveryApplyEnvelope(request(root, 'stale-recovery-gate', RECOVERY_GATE), inspected, 'cleanup')
      assert.throws(() => applyRecovery(applyRequest, { killProcess: absentPid() }), (error) => error.record?.code === 'snapshot-drift' && error.record.phase === 'prevalidate')
      assert.equal(existsSync(rogue), true)
      const dispatched = runPrivateDispatcher(Buffer.from(`${canonicalJson(applyRequest)}\n`, 'utf8'), { 'recover-apply': (value) => applyRecovery(value, { killProcess: absentPid() }) })
      const record = JSON.parse(dispatched.stdout.toString('utf8'))
      assert.equal(dispatched.exitCode, 1, dispatched.stdout.toString('utf8'))
      assert.equal(record.code, 'snapshot-drift')
      assert.equal(record.phase, 'prevalidate')
      assert.equal(existsSync(rogue), true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('stale recovery gate rejects an owner-only gate gaining a same-inode owner stage', () => {
    if (process.platform === 'win32') return
    const root = fixtureRoot()
    try {
      const gate = join(root, RECOVERY_GATE)
      const owner = join(gate, 'owner.json')
      const stage = join(gate, 'owner.new')
      mkdirSync(gate, { mode: 0o700 })
      writeCanonical(owner, gateOwner(root))
      const inspected = inspectRecovery(request(root, 'stale-recovery-gate', RECOVERY_GATE), { killProcess: absentPid(), platform: 'linux' })
      linkSync(owner, stage)
      const applyRequest = recoveryApplyEnvelope(request(root, 'stale-recovery-gate', RECOVERY_GATE), inspected, 'cleanup')
      assert.throws(() => applyRecovery(applyRequest, { killProcess: absentPid(), platform: 'linux' }), (error) => error.record?.code === 'snapshot-drift' && error.record.phase === 'prevalidate')
      assert.equal(existsSync(owner), true)
      assert.equal(existsSync(stage), true)
      const dispatched = runPrivateDispatcher(Buffer.from(`${canonicalJson(applyRequest)}\n`, 'utf8'), { 'recover-apply': (value) => applyRecovery(value, { killProcess: absentPid(), platform: 'linux' }) })
      const record = JSON.parse(dispatched.stdout.toString('utf8'))
      assert.equal(dispatched.exitCode, 1, dispatched.stdout.toString('utf8'))
      assert.equal(record.code, 'snapshot-drift', dispatched.stdout.toString('utf8'))
      assert.equal(record.phase, 'prevalidate')
      assert.equal(existsSync(owner), true)
      assert.equal(existsSync(stage), true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('stale-recovery-gate cleanup retries after each owner-stage, owner, and gate removal prefix', () => {
    for (const removed of ['owner.new', 'owner.json', 'gate']) {
      const root = fixtureRoot()
      try {
        const gate = join(root, RECOVERY_GATE)
        mkdirSync(gate, { mode: 0o700 })
        const stage = join(gate, 'owner.new')
        writeCanonical(stage, gateOwner(root))
        linkSync(stage, join(gate, 'owner.json'))
        const target = RECOVERY_GATE
        const inspected = inspectRecovery(request(root, 'stale-recovery-gate', target), { killProcess: absentPid() })
        if (removed === 'owner.new') rmSync(stage)
        if (removed === 'owner.json') rmSync(join(gate, 'owner.json'))
        if (removed === 'gate') rmSync(gate, { force: true, recursive: true })
        const result = applyRecovery({ ...request(root, 'stale-recovery-gate', target), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'cleanup' }, { killProcess: absentPid() })
        assert.ok(['completed', 'already-complete'].includes(result.status), `${removed}: ${result.status}`)
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    }
  })

  test('recovery gate stage-only and owner-only residues require one link while the published pair shares one inode with two links', () => {
    for (const shape of ['stage-only', 'owner-only', 'pair']) {
      const root = fixtureRoot()
      try {
        const gate = join(root, RECOVERY_GATE)
        mkdirSync(gate, { mode: 0o700 })
        const stage = join(gate, 'owner.new')
        const owner = join(gate, 'owner.json')
        writeCanonical(stage, gateOwner(root))
        if (shape === 'pair') linkSync(stage, owner)
        if (shape === 'stage-only') {
          const extra = join(root, 'extra-stage-link')
          linkSync(stage, extra)
          assert.throws(() => inspectRecovery(request(root, 'stale-recovery-gate', RECOVERY_GATE), { killProcess: absentPid() }), /link|identity|extra|inspection failed/i)
          rmSync(extra)
        } else if (shape === 'owner-only') {
          rmSync(stage)
          writeCanonical(owner, gateOwner(root))
          const extra = join(root, 'extra-owner-link')
          linkSync(owner, extra)
          assert.throws(() => inspectRecovery(request(root, 'stale-recovery-gate', RECOVERY_GATE), { killProcess: absentPid() }), /link|identity|inspection failed/i)
          rmSync(extra)
        } else {
          assert.equal(statSync(stage).nlink, 2)
          assert.equal(statSync(owner).nlink, 2)
          assert.equal(statSync(stage).ino, statSync(owner).ino)
        }
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    }
  })

  test('stale recovery gate cleanup accepts stage-only evidence becoming its exact same-inode owner pair', () => {
    const root = fixtureRoot()
    try {
      const gate = join(root, RECOVERY_GATE)
      const stage = join(gate, 'owner.new')
      const owner = join(gate, 'owner.json')
      mkdirSync(gate, { mode: 0o700 })
      writeCanonical(stage, gateOwner(root))
      const inspected = inspectRecovery(request(root, 'stale-recovery-gate', RECOVERY_GATE), { killProcess: absentPid() })
      linkSync(stage, owner)
      const applied = applyRecovery({ ...request(root, 'stale-recovery-gate', RECOVERY_GATE), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'cleanup' }, { killProcess: absentPid() })
      assert.equal(applied.status, 'completed')
      assert.equal(existsSync(stage), false)
      assert.equal(existsSync(owner), false)
      assert.equal(existsSync(gate), false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }

    const successorRoot = fixtureRoot()
    try {
      const gate = join(successorRoot, RECOVERY_GATE)
      const stage = join(gate, 'owner.new')
      mkdirSync(gate, { mode: 0o700 })
      writeCanonical(stage, gateOwner(successorRoot))
      const inspected = inspectRecovery(request(successorRoot, 'stale-recovery-gate', RECOVERY_GATE), { killProcess: absentPid() })
      writeCanonical(stage, { ...gateOwner(successorRoot), ownerNonce: 'e'.repeat(32) })
      assert.throws(() => applyRecovery({ ...request(successorRoot, 'stale-recovery-gate', RECOVERY_GATE), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'cleanup' }, { killProcess: absentPid() }), (error) => error.record?.code === 'snapshot-drift' && error.record.phase === 'prevalidate')
      assert.equal(existsSync(stage), true)
      assert.equal(existsSync(join(gate, 'owner.json')), false)
      assert.equal(existsSync(gate), true)
    } finally {
      rmSync(successorRoot, { force: true, recursive: true })
    }
  })

  test('recovery cleanup retains a replaced temporary, stale lock, gate stage, and gate owner successor', () => {
    const cases = ['temporary', 'lock', 'owner.new', 'owner.json']
    for (const kind of cases) {
      const root = fixtureRoot()
      try {
        let inspected
        if (kind === 'temporary') {
          const nonce = 'b'.repeat(32)
          const target = `.nightshift-init-backlog.${'c'.repeat(64)}.1.tmp`
          writeCanonical(join(root, '.nightshift-init-backlog.lock'), { createdAtUnixMs: 0, manifestId: 'c'.repeat(64), operation: 'apply', ownerNonce: nonce, pid: 321, protocolVersion: 1, recoveryId: null, root, temporaryPaths: [target], unfinalizedDirectories: [] })
          writeFileSync(join(root, target), Buffer.from('old', 'utf8'), { mode: 0o600 })
          inspected = inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
          writeFileSync(join(root, target), Buffer.from('successor', 'utf8'), { mode: 0o600 })
          assert.throws(() => applyRecovery({ ...request(root, 'stale-owner', '.nightshift-init-backlog.lock'), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'cleanup' }, { killProcess: absentPid() }), /changed|snapshot|filesystem|publication failed/i)
          assert.deepEqual(readFileSync(join(root, target)), Buffer.from('successor', 'utf8'))
        } else {
          const gate = join(root, RECOVERY_GATE)
          mkdirSync(gate, { mode: 0o700 })
          if (kind === 'lock') {
            ownerFixture(root)
            inspected = inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
            writeCanonical(join(root, '.nightshift-init-backlog.lock'), { ...ownerFixture(root).lock, ownerNonce: 'e'.repeat(32) })
            assert.throws(() => applyRecovery({ ...request(root, 'stale-owner', '.nightshift-init-backlog.lock'), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'cleanup' }, { killProcess: absentPid() }), /changed|snapshot|filesystem|publication failed/i)
            assert.equal(JSON.parse(readFileSync(join(root, '.nightshift-init-backlog.lock'), 'utf8')).ownerNonce, 'e'.repeat(32))
          } else {
            const stage = join(gate, 'owner.new')
            writeCanonical(stage, gateOwner(root))
            linkSync(stage, join(gate, 'owner.json'))
            inspected = inspectRecovery(request(root, 'stale-recovery-gate', RECOVERY_GATE), { killProcess: absentPid() })
            writeCanonical(join(gate, kind), { ...gateOwner(root), ownerNonce: 'e'.repeat(32) })
            assert.throws(() => applyRecovery({ ...request(root, 'stale-recovery-gate', RECOVERY_GATE), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'cleanup' }, { killProcess: absentPid() }), /changed|snapshot|filesystem|publication failed/i)
            assert.equal(JSON.parse(readFileSync(join(gate, kind), 'utf8')).ownerNonce, 'e'.repeat(32))
          }
        }
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    }
  })

  test('bootstrap manifest-null inventory admits only fixed stage and upgrade names', () => {
    const root = fixtureRoot()
    try {
      const pid = 321
      const nonce = 'a'.repeat(32)
      const initial = `.nightshift-init-backlog.lock.${pid}.${nonce}.new`
      const upgrade = `.nightshift-init-backlog.lock.${nonce}.next`
      const base = { createdAtUnixMs: 0, manifestId: null, operation: 'apply', ownerNonce: nonce, pid, protocolVersion: 1, recoveryId: null, root, unfinalizedDirectories: [] }
      for (const target of [initial, upgrade]) {
        writeCanonical(join(root, '.nightshift-init-backlog.lock'), { ...base, temporaryPaths: [target] })
        const inspected = inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
        assert.equal(inspected.evidence.owner.record.temporaryPaths[0], target)
        rmSync(join(root, '.nightshift-init-backlog.lock'))
      }
      const invalid = '.nightshift-init-backlog-user.tmp'
      writeCanonical(join(root, '.nightshift-init-backlog.lock'), { ...base, temporaryPaths: [invalid] })
      assert.throws(() => inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() }), /malformed|temporary|lock|inspection failed/i)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('abandoned backup inspection and restore publish the approved bytes and remove backup', () => {
    const root = fixtureRoot()
    try {
      mkdirSync(join(root, '.tmp'), { mode: 0o700 })
      const target = 'FEATURES.md'
      const original = Buffer.from('original\n', 'utf8')
      const current = Buffer.from('changed\n', 'utf8')
      writeFileSync(join(root, target), current, { mode: 0o644 })
      const backupTargetHash = sha256(Buffer.from(target, 'utf8'))
      const backupTarget = `.tmp/nightshift-init-backlog-unwrap-${'d'.repeat(64)}-${'e'.repeat(64)}-${backupTargetHash}.bak`
      writeFileSync(join(root, ...backupTarget.split('/')), original, { mode: 0o644 })
      const inspected = inspectRecovery(request(root, 'abandoned-backup', backupTarget), { currentInspection: { targets: [{ target }] } })
      assert.equal(inspected.evidence.backup.classification, 'divergent')
      assert.deepEqual(inspected.allowedDispositions, ['restore', 'accept'])
      const applied = applyRecovery({ ...request(root, 'abandoned-backup', backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'restore' })

      assert.equal(applied.status, 'completed')
      assert.deepEqual(require('node:fs').readFileSync(join(root, target)), original)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('batch backup records every unwrap target before the first target publication', () => {
    const fixture = unwrapFixture(2)
    try {
      const result = publishApply(fixture.applyRequest, { currentInspection: fixture.carried, collectInspection: () => fixture.post })

      assert.equal(result.retainedBackups.length, 0)
      assert.equal(result.outcomes.length, 2)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('unwrap backup path uses snapshot then manifest then target hash in the exact order', () => {
    const fixture = unwrapFixture(1)
    try {
      const manifestId = admitApplyManifest(fixture.applyRequest).manifestId
      assert.throws(() => publishApply(fixture.applyRequest, { currentInspection: fixture.carried, collectInspection: () => fixture.post, crash: true, ownerNonce: 'a'.repeat(32), onPublished: (destination) => { if (destination.endsWith('.bak')) throw new Error('crash after backup publication') } }), /crash|Injected publication failure/)
      const lock = JSON.parse(readFileSync(join(fixture.root, '.nightshift-init-backlog.lock'), 'utf8'))
      const backupTarget = lock.temporaryPaths.find((item) => item.endsWith('.bak'))
      const expected = `.tmp/nightshift-init-backlog-unwrap-${fixture.carried.snapshotId}-${manifestId}-${sha256(Buffer.from(fixture.actions[0].target, 'utf8'))}.bak`
      assert.equal(backupTarget, expected)
      const swapped = `.tmp/nightshift-init-backlog-unwrap-${manifestId}-${fixture.carried.snapshotId}-${sha256(Buffer.from(fixture.actions[0].target, 'utf8'))}.bak`
      assert.throws(() => assert.equal(backupTarget, swapped))
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('recovery inspection identity binds apply to the exact root and approved evidence', () => {
    const root = fixtureRoot()
    const otherRoot = fixtureRoot()
    try {
      const backupTargetHash = sha256(Buffer.from('FEATURES.md', 'utf8'))
      const backupTarget = `.tmp/nightshift-init-backlog-unwrap-${'a'.repeat(64)}-${'b'.repeat(64)}-${backupTargetHash}.bak`
      mkdirSync(join(root, '.tmp'), { mode: 0o700 })
      writeFileSync(join(root, ...backupTarget.split('/')), Buffer.from('before\n', 'utf8'), { mode: 0o644 })
      writeFileSync(join(root, 'FEATURES.md'), Buffer.from('after\n', 'utf8'), { mode: 0o644 })
      const inspected = inspectRecovery(request(root, 'abandoned-backup', backupTarget), { currentInspection: { targets: [{ target: 'FEATURES.md' }] } })

      assert.throws(() => applyRecovery({ ...request(otherRoot, 'abandoned-backup', backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'restore' }), /invalid|root/i)
    } finally {
      rmSync(root, { force: true, recursive: true })
      rmSync(otherRoot, { force: true, recursive: true })
    }
  })

  test('unwrap publication verifies the predicted ready delta after recovery', () => {
    const fixture = unwrapFixture()
    try {
      const result = publishApply(fixture.applyRequest, { currentInspection: fixture.carried, collectInspection: () => ({ ...fixture.post, ready: fixture.carried.unwrapReady.after }) })

      assert.deepEqual(result.postInspect.ready, fixture.carried.unwrapReady.after)
      assert.deepEqual(result.retainedBackups, [])
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('unwrap rollback preserves an external target edit observed before restoration', () => {
    const fixture = unwrapFixture()
    const external = Buffer.from('external edit\n', 'utf8')
    const manifestId = admitApplyManifest(fixture.applyRequest).manifestId
    const backupTarget = `.tmp/nightshift-init-backlog-unwrap-${fixture.carried.snapshotId}-${manifestId}-${sha256(Buffer.from(fixture.actions[0].target, 'utf8'))}.bak`
    try {
      assert.throws(() => publishApply(fixture.applyRequest, {
        collectInspection: () => {
          writeFileSync(join(fixture.root, fixture.actions[0].target), external)

          return { ...fixture.post, ready: { ...fixture.post.ready, found: ['external-edit'] } }
        },
        currentInspection: fixture.carried,
      }), (error) => {
        assert.equal(error.record?.code, 'restore-failed')
        assert.deepEqual(error.record?.recovery?.retainedBackups, [backupTarget])
        return true
      })
      assert.deepEqual(readFileSync(join(fixture.root, fixture.actions[0].target)), external)
      assert.equal(existsSync(join(fixture.root, ...backupTarget.split('/'))), true)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('unwrap ready mismatch removes verified backups before returning ready-delta', () => {
    const fixture = unwrapFixture()
    const manifestId = admitApplyManifest(fixture.applyRequest).manifestId
    const backupTarget = `.tmp/nightshift-init-backlog-unwrap-${fixture.carried.snapshotId}-${manifestId}-${sha256(Buffer.from(fixture.actions[0].target, 'utf8'))}.bak`
    try {
      assert.throws(() => publishApply(fixture.applyRequest, { collectInspection: () => ({ ...fixture.post, ready: { ...fixture.post.ready, found: ['external-edit'] } }), currentInspection: fixture.carried }), (error) => {
        assert.equal(error.record?.code, 'ready-delta')
        assert.deepEqual(error.record?.recovery, { retainedBackups: [], status: 'none', warnings: [] })
        return true
      })
      assert.deepEqual(readFileSync(join(fixture.root, fixture.actions[0].target)), Buffer.from(`# Header 0\n\nparagraph first\nparagraph continuation\n`, 'utf8'))
      assert.equal(existsSync(join(fixture.root, ...backupTarget.split('/'))), false)
      assert.deepEqual(readdirSync(join(fixture.root, '.tmp')), [])
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('accepted presentation and slice reclassification remain distinct recovery classes', () => {
    const root = fixtureRoot()
    try {
      mkdirSync(join(root, '.tmp'), { mode: 0o700 })
      const targetHash = sha256(Buffer.from('FEATURES.md', 'utf8'))
      const backupTarget = `.tmp/nightshift-init-backlog-unwrap-${'c'.repeat(64)}-${'d'.repeat(64)}-${targetHash}.bak`
      const bytes = Buffer.from('same\n', 'utf8')
      writeFileSync(join(root, 'FEATURES.md'), bytes, { mode: 0o644 })
      writeFileSync(join(root, ...backupTarget.split('/')), bytes, { mode: 0o644 })
      const redundant = inspectRecovery(request(root, 'abandoned-backup', backupTarget), { currentInspection: { targets: [{ target: 'FEATURES.md' }] } })

      assert.equal(redundant.evidence.backup.classification, 'redundant')
      assert.deepEqual(redundant.allowedDispositions, ['remove'])
      writeFileSync(join(root, 'FEATURES.md'), Buffer.from('reclassified\n', 'utf8'), { mode: 0o644 })
      const divergent = inspectRecovery(request(root, 'abandoned-backup', backupTarget), { currentInspection: { targets: [{ target: 'FEATURES.md' }] } })
      assert.equal(divergent.evidence.backup.classification, 'divergent')
      assert.deepEqual(divergent.allowedDispositions, ['restore', 'accept'])
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('unexpected backup drift is rejected before restore writes the target', () => {
    const root = fixtureRoot()
    try {
      mkdirSync(join(root, '.tmp'), { mode: 0o700 })
      const targetHash = sha256(Buffer.from('FEATURES.md', 'utf8'))
      const backupTarget = `.tmp/nightshift-init-backlog-unwrap-${'e'.repeat(64)}-${'f'.repeat(64)}-${targetHash}.bak`
      writeFileSync(join(root, 'FEATURES.md'), Buffer.from('current\n', 'utf8'), { mode: 0o644 })
      writeFileSync(join(root, ...backupTarget.split('/')), Buffer.from('backup\n', 'utf8'), { mode: 0o644 })
      const inspected = inspectRecovery(request(root, 'abandoned-backup', backupTarget), { currentInspection: { targets: [{ target: 'FEATURES.md' }] } })
      writeFileSync(join(root, 'FEATURES.md'), Buffer.from('external\n', 'utf8'), { mode: 0o644 })

      assert.throws(() => applyRecovery({ ...request(root, 'abandoned-backup', backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'restore' }), /changed|drift/i)
      assert.deepEqual(readFileSync(join(root, 'FEATURES.md')), Buffer.from('external\n', 'utf8'))
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('restore and cleanup failures retain evidence and report the failed recovery phase', () => {
    const root = fixtureRoot()
    try {
      mkdirSync(join(root, '.tmp'), { mode: 0o700 })
      const targetHash = sha256(Buffer.from('FEATURES.md', 'utf8'))
      const backupTarget = `.tmp/nightshift-init-backlog-unwrap-${'1'.repeat(64)}-${'2'.repeat(64)}-${targetHash}.bak`
      writeFileSync(join(root, 'FEATURES.md'), Buffer.from('current\n', 'utf8'), { mode: 0o644 })
      writeFileSync(join(root, ...backupTarget.split('/')), Buffer.from('backup\n', 'utf8'), { mode: 0o644 })
      const inspected = inspectRecovery(request(root, 'abandoned-backup', backupTarget), { currentInspection: { targets: [{ target: 'FEATURES.md' }] } })

      assert.throws(() => applyRecovery({ ...request(root, 'abandoned-backup', backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'restore' }, { renameSync: () => { throw new Error('cleanup failure') } }), /cleanup|filesystem|recovery/i)
      assert.equal(existsSync(join(root, ...backupTarget.split('/'))), true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('attended recovery requires explicit disposition while unattended recovery fails closed', () => {
    const root = fixtureRoot()
    try {
      mkdirSync(join(root, '.tmp'), { mode: 0o700 })
      const targetHash = sha256(Buffer.from('FEATURES.md', 'utf8'))
      const backupTarget = `.tmp/nightshift-init-backlog-unwrap-${'3'.repeat(64)}-${'4'.repeat(64)}-${targetHash}.bak`
      writeFileSync(join(root, 'FEATURES.md'), Buffer.from('current\n', 'utf8'), { mode: 0o644 })
      writeFileSync(join(root, ...backupTarget.split('/')), Buffer.from('backup\n', 'utf8'), { mode: 0o644 })
      const inspected = inspectRecovery(request(root, 'abandoned-backup', backupTarget), { currentInspection: { targets: [{ target: 'FEATURES.md' }] } })

      assert.throws(() => applyRecovery({ ...request(root, 'abandoned-backup', backupTarget), operation: 'recover-apply', recoveryInspection: inspected }), /disposition|invalid/i)
      assert.throws(() => applyRecovery({ ...request(root, 'abandoned-backup', backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'cleanup' }, { unattended: true }), /authority|unattended|disposition|invalid/i)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('recovery temporary files use POSIX modes without a post-publication chmod', () => {
    const root = fixtureRoot()
    try {
      mkdirSync(join(root, '.tmp'), { mode: 0o700 })
      const targetHash = sha256(Buffer.from('FEATURES.md', 'utf8'))
      const backupTarget = `.tmp/nightshift-init-backlog-unwrap-${'5'.repeat(64)}-${'6'.repeat(64)}-${targetHash}.bak`
      writeFileSync(join(root, 'FEATURES.md'), Buffer.from('current\n', 'utf8'), { mode: 0o644 })
      writeFileSync(join(root, ...backupTarget.split('/')), Buffer.from('backup\n', 'utf8'), { mode: 0o600 })
      const inspected = inspectRecovery(request(root, 'abandoned-backup', backupTarget), { currentInspection: { targets: [{ target: 'FEATURES.md' }] } })
      const chmods = []
      const applied = applyRecovery({ ...request(root, 'abandoned-backup', backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'restore' }, { chmodSync: (...args) => { chmods.push(args); chmodSync(...args) } })

      assert.equal(applied.status, 'completed')
      if (process.platform !== 'win32') assert.equal(statSync(join(root, 'FEATURES.md')).mode & 0o777, 0o600)
      assert.deepEqual(chmods, [])
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('unwrap backup protects the complete batch before the first publish', () => {
    const fixture = unwrapFixture(3)
    try {
      const writes = []
      const result = publishApply(fixture.applyRequest, { currentInspection: fixture.carried, collectInspection: () => fixture.post, writeSpy: (path) => writes.push(path) })

      assert.equal(result.retainedBackups.length, 0)
      const firstTargetWrite = writes.findIndex((path) => fixture.actions.some((action) => path.endsWith(`/${action.target}`)))
      const lastBackupWrite = writes.reduce((index, path, current) => path.includes('unwrap-') ? current : index, -1)
      assert.ok(lastBackupWrite >= 0)
      assert.ok(firstTargetWrite < 0 || lastBackupWrite < firstTargetWrite)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('unwrap backup path binds snapshot manifest and target identity', () => {
    const fixture = backupFixture()
    try {
      const inspected = backupInspection(fixture)
      const other = backupFixture('OTHER.md')
      try {
        assert.throws(() => applyRecovery({ ...request(other.root, 'abandoned-backup', fixture.backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'restore' }), /root|invalid|snapshot/i)
      } finally {
        rmSync(other.root, { force: true, recursive: true })
      }
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('unwrap batch compares the complete predicted ready result', () => {
    const fixture = unwrapFixture()
    try {
      const result = publishApply(fixture.applyRequest, { currentInspection: fixture.carried, collectInspection: () => ({ ...fixture.post, ready: fixture.carried.unwrapReady.after, problems: [{ blocking: true, code: 'structural-error', evidencePaths: [], target: 'FEATURES-0.md' }] }) })

      assert.deepEqual(result.postInspect.ready, fixture.carried.unwrapReady.after)
      assert.equal(result.complete, false)
      assert.deepEqual(result.incompleteTargets, ['FEATURES-0.md'])
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('unwrap accepts a presentation-only ready reclassification', () => {
    const fixture = backupFixture()
    try {
      const inspected = backupInspection(fixture)
      assert.equal(inspected.evidence.backup.classification, 'divergent')
      assert.deepEqual(inspected.allowedDispositions, ['restore', 'accept'])
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('unwrap accepts a slice reclassification ready delta', () => {
    const fixture = backupFixture()
    try {
      const inspected = backupInspection(fixture)
      const replay = inspectRecovery(request(fixture.root, 'abandoned-backup', fixture.backupTarget), { currentInspection: { targets: [{ target: fixture.target, states: ['wrapped'] }] } })
      assert.equal(replay.evidence.backup.classification, inspected.evidence.backup.classification)
      assert.deepEqual(replay.allowedDispositions, inspected.allowedDispositions)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('unwrap rejects an unexpected ready delta and restores every target', () => {
    const fixture = unwrapFixture(2)
    try {
      assert.throws(() => publishApply(fixture.applyRequest, { currentInspection: fixture.carried, collectInspection: () => ({ ...fixture.post, ready: { blocked: [], external: [], found: [], indexes: { found: [], missing: [] }, ready: ['unexpected.md'] } }) }), /ready|drift|incomplete/i)
      assert.deepEqual(readFileSync(join(fixture.root, 'FEATURES-0.md')), Buffer.from('# Header 0\n\nparagraph first\nparagraph continuation\n', 'utf8'))
      assert.deepEqual(readFileSync(join(fixture.root, 'FEATURES-1.md')), Buffer.from('# Header 1\n\nparagraph first\nparagraph continuation\n', 'utf8'))
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('unwrap ready inequality reports the ready-delta verification carrier', () => {
    const fixture = unwrapFixture()
    try {
      assert.throws(() => publishApply(fixture.applyRequest, { currentInspection: fixture.carried, collectInspection: () => ({ ...fixture.post, ready: { blocked: [], external: [], found: [], indexes: { found: [], missing: [] }, ready: ['unexpected.md'] } }) }), (error) => error.record?.code === 'ready-delta' && error.record.phase === 'verify' && error.record.manifestId !== null)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('ready parser failure remains distinct from an aggregate ready delta', () => {
    const fixture = unwrapFixture()
    try {
      const readyFailure = new InitBacklogError(failureRecord({ code: 'ready-failed', detail: 'ready parser failed after unwrap', operation: 'apply', phase: 'verify' }))
      assert.throws(() => publishApply(fixture.applyRequest, { currentInspection: fixture.carried, collectInspection: () => { throw readyFailure } }), (error) => error.record?.code === 'ready-failed' && error.record.phase === 'verify')
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('unwrap crash retains every backup and the staged rollback temporary in the owning inventory', () => {
    const fixture = unwrapFixture(2)
    try {
      const manifestId = admitApplyManifest(fixture.applyRequest).manifestId
      const backupTargets = fixture.actions.map((action) => `.tmp/nightshift-init-backlog-unwrap-${fixture.carried.snapshotId}-${manifestId}-${sha256(Buffer.from(action.target, 'utf8'))}.bak`).sort(compareOrdinal)
      const rollbackTemporaries = fixture.actions.map((action) => `.nightshift-init-backlog.${manifestId}.${sha256(Buffer.from(action.target, 'utf8'))}.tmp`).sort(compareOrdinal)
      let renameAttempts = 0
      assert.throws(() => publishApply(fixture.applyRequest, { currentInspection: fixture.carried, collectInspection: () => ({ ...fixture.post, ready: { blocked: [], external: [], found: [], indexes: { found: [], missing: [] }, ready: ['unexpected.md'] } }), crash: true, onBeforeRename: () => {
        renameAttempts += 1
        if (renameAttempts === 2) throw new Error('crash during second rollback')
      } }), (error) => error.record?.code === 'restore-failed' && error.record.phase === 'restore' && error.record.recovery?.status === 'restore-failed' && error.record.recovery.retainedBackups.join('\0') === backupTargets.join('\0'))
      assert.equal(renameAttempts, 2)
      assert.deepEqual(backupTargets.map((target) => existsSync(join(fixture.root, ...target.split('/')))), [true, true])
      assert.equal(readFileSync(join(fixture.root, 'FEATURES-1.md'), 'utf8'), '# Header 1\n\nparagraph first\nparagraph continuation\n')
      const lock = JSON.parse(readFileSync(join(fixture.root, '.nightshift-init-backlog.lock'), 'utf8'))
      assert.deepEqual(lock.temporaryPaths.filter((target) => rollbackTemporaries.includes(target)), rollbackTemporaries)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('recover-apply uses the exact recovery temporary grammar and retains its inventory on pre-rename failure', () => {
    const fixture = backupFixture()
    try {
      const inspected = backupInspection(fixture)
      const expectedTemporary = `.nightshift-init-backlog.${inspected.recoveryId}.${sha256(Buffer.from(fixture.target, 'utf8'))}.tmp`
      assert.throws(() => applyRecovery({ ...request(fixture.root, 'abandoned-backup', fixture.backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'restore' }, { onBeforeRename: () => { throw new Error('pre-rename failure') } }), (error) => error.record?.code === 'restore-failed' && error.record.phase === 'restore' && error.record.recovery?.status === 'restore-failed' && canonicalJson(error.record.recovery.retainedBackups) === canonicalJson([fixture.backupTarget]))
      assert.equal(existsSync(join(fixture.root, ...expectedTemporary.split('/'))), true)
      assert.equal(existsSync(join(fixture.root, `${fixture.target}.nightshift-recovery-${inspected.recoveryId}.tmp`)), false)
      const lock = JSON.parse(readFileSync(join(fixture.root, '.nightshift-init-backlog.lock'), 'utf8'))
      assert.ok(lock.temporaryPaths.includes(expectedTemporary))
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('interrupted abandoned-backup restore remains inspectable through stale-owner recovery', () => {
    const fixture = backupFixture()
    try {
      const inspected = backupInspection(fixture)
      const recoveryOptions = { killProcess: absentPid(), onBeforeRename: () => { throw new Error('interrupted restore') }, ownerNonce: 'c'.repeat(32), pid: 321 }
      assert.throws(() => applyRecovery({ ...request(fixture.root, 'abandoned-backup', fixture.backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'restore' }, recoveryOptions), (error) => error.record?.code === 'restore-failed')

      const stale = inspectRecovery(request(fixture.root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
      assert.ok(stale.evidence.owner.record.temporaryPaths.includes(fixture.backupTarget))
      assert.equal(stale.evidence.owner.temporaryStates.find((item) => item.target === fixture.backupTarget).present, true)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('unwrap restore publishes every original image in reverse order', () => {
    const fixture = unwrapFixture(2)
    try {
      const restored = []
      assert.throws(() => publishApply(fixture.applyRequest, { currentInspection: fixture.carried, collectInspection: () => ({ ...fixture.post, ready: { blocked: [], external: [], found: [], indexes: { found: [], missing: [] }, ready: ['unexpected.md'] } }), writeSpy: (path) => restored.push(path) }), /ready|drift|incomplete/i)
      assert.deepEqual(readFileSync(join(fixture.root, 'FEATURES-0.md')), Buffer.from('# Header 0\n\nparagraph first\nparagraph continuation\n', 'utf8'))
      assert.deepEqual(readFileSync(join(fixture.root, 'FEATURES-1.md')), Buffer.from('# Header 1\n\nparagraph first\nparagraph continuation\n', 'utf8'))
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('unwrap restore failure retains the affected backup and returns restore-failed', () => {
    const fixture = backupFixture()
    try {
      const inspected = backupInspection(fixture)
      assert.throws(() => applyRecovery({ ...request(fixture.root, 'abandoned-backup', fixture.backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'restore' }, { renameSync: () => { throw new Error('restore failure') } }), /restore|filesystem|recovery/i)
      assert.equal(existsSync(join(fixture.root, ...fixture.backupTarget.split('/'))), true)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('unwrap cleanup failure retains the backup and returns cleanup-failed', () => {
    const fixture = backupFixture()
    try {
      const inspected = backupInspection(fixture)
      assert.throws(() => applyRecovery({ ...request(fixture.root, 'abandoned-backup', fixture.backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'remove' }, { removeAndVerify: () => { throw new Error('cleanup failure') } }), /cleanup|filesystem|recovery/i)
      assert.equal(existsSync(join(fixture.root, ...fixture.backupTarget.split('/'))), true)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('abandoned backup inspection returns bounded comparison evidence', () => {
    const fixture = backupFixture()
    try {
      const inspected = backupInspection(fixture)
      assert.equal(typeof inspected.recoveryId, 'string')
      assert.equal(inspected.evidence.backup.backupContentBase64, Buffer.from('backup\n', 'utf8').toString('base64'))
      assert.equal(inspected.evidence.backup.currentContentBase64, Buffer.from('current\n', 'utf8').toString('base64'))
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('stale owner inspection requires an absent pid and carries its inventory', () => {
    const root = fixtureRoot()
    try {
      const nonce = 'c'.repeat(32)
      const temporary = `.nightshift-init-backlog.${'d'.repeat(64)}.1.tmp`
      const lock = { createdAtUnixMs: 0, manifestId: 'd'.repeat(64), operation: 'apply', ownerNonce: nonce, pid: 321, protocolVersion: 1, recoveryId: null, root, temporaryPaths: [temporary], unfinalizedDirectories: [] }
      writeCanonical(join(root, '.nightshift-init-backlog.lock'), lock)
      writeFileSync(join(root, temporary), Buffer.from('temp', 'utf8'), { mode: 0o600 })
      const inspected = inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
      assert.equal(inspected.evidence.owner.pidStatus, 'absent')
      assert.equal(inspected.evidence.owner.temporaryStates[0].present, true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('election residue exposes only legal dispositions', () => {
    const root = fixtureRoot()
    try {
      writeCanonical(join(root, ELECTION_MARKER_PATH), { invalid: true })
      const inspected = inspectRecovery(request(root, 'election-marker', ELECTION_MARKER_PATH), { currentInspection: { git: { kind: 'git', freshScaffold: true } } })
      assert.deepEqual(inspected.allowedDispositions, ['deferred', 'track', 'ignore', 'abandon'])
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('malformed non-JSON election marker supports an approved replacement disposition', () => {
    const root = fixtureRoot()
    const markerPath = join(root, ELECTION_MARKER_PATH)
    const malformed = Buffer.from('not-json\n', 'utf8')
    try {
      writeFileSync(markerPath, malformed, { mode: 0o600 })
      const currentInspection = { git: { kind: 'git', freshScaffold: true } }
      const inspected = inspectRecovery(request(root, 'election-marker', ELECTION_MARKER_PATH), { currentInspection })
      assert.equal(inspected.evidence.marker.classification, 'invalid')
      assert.equal(inspected.evidence.marker.rawSha256, sha256(malformed))

      const applied = applyRecovery({ ...request(root, 'election-marker', ELECTION_MARKER_PATH), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'deferred' }, { currentInspection })

      assert.equal(applied.status, 'completed')
      assert.deepEqual(JSON.parse(readFileSync(markerPath, 'utf8')), { protocolVersion: 1, root, snapshotId: sha256(Buffer.from(canonicalJson({ invalidMarkerSha256: sha256(malformed), protocolVersion: 1, root, state: 'deferred' }), 'utf8')), state: 'deferred' })
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('same-mode election marker replacement after inspection fails without mutation', () => {
    const root = fixtureRoot()
    const markerPath = join(root, ELECTION_MARKER_PATH)
    try {
      writeFileSync(markerPath, Buffer.from('not-json\n', 'utf8'), { mode: 0o600 })
      const currentInspection = { git: { kind: 'git', freshScaffold: true } }
      const inspected = inspectRecovery(request(root, 'election-marker', ELECTION_MARKER_PATH), { currentInspection })
      const replacement = Buffer.from('writer-replacement\n', 'utf8')
      assert.throws(
        () => applyRecovery({ ...request(root, 'election-marker', ELECTION_MARKER_PATH), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'deferred' }, { currentInspection, onBeforeRename: () => { rmSync(markerPath); writeFileSync(markerPath, replacement, { mode: 0o600 }) } }),
        (error) => error.record?.code === 'snapshot-drift',
      )
      assert.deepEqual(readFileSync(markerPath), replacement)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('election-marker recovery requires the fixed recovery target', () => {
    const root = fixtureRoot()
    const target = 'arbitrary-marker-label'
    try {
      writeCanonical(join(root, ELECTION_MARKER_PATH), { invalid: true })
      const inspected = inspectRecovery(request(root, 'election-marker', target), { currentInspection: { git: { kind: 'git', freshScaffold: true } } })
      assert.throws(() => applyRecovery({ ...request(root, 'election-marker', target), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'abandon' }), /target|recovery|invalid/i)
      assert.equal(existsSync(join(root, ELECTION_MARKER_PATH)), true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('live owner residue remains blocked', () => {
    const root = fixtureRoot()
    try {
      const lock = { createdAtUnixMs: 0, manifestId: 'e'.repeat(64), operation: 'apply', ownerNonce: 'f'.repeat(32), pid: 321, protocolVersion: 1, recoveryId: null, root, temporaryPaths: [], unfinalizedDirectories: [] }
      writeCanonical(join(root, '.nightshift-init-backlog.lock'), lock)
      assert.throws(() => inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: () => {} }), /live|runtime-lock/i)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('malformed or oversized residue fails closed', () => {
    const root = fixtureRoot()
    try {
      const target = `.nightshift-init-backlog.lock.123.${'a'.repeat(32)}.new`
      writeFileSync(join(root, target), Buffer.alloc(2 * 1024 * 1024, 0x61), { mode: 0o600 })
      assert.throws(() => inspectRecovery(request(root, 'orphan-lock-stage', target), { killProcess: absentPid() }), /payload|size|filesystem|runtime-lock/i)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('missing recovery manifest is rejected before apply', () => {
    const fixture = backupFixture()
    try {
      assert.throws(() => applyRecovery({ ...request(fixture.root, 'abandoned-backup', fixture.backupTarget), operation: 'recover-apply', disposition: 'remove' }), /invalid|manifest|inspection/i)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('orphan stage valid bytes produce removable evidence', () => {
    const root = fixtureRoot()
    try {
      const target = stageFixture(root, 123)
      const result = inspectRecovery(request(root, 'orphan-lock-stage', target), { killProcess: absentPid() })
      assert.equal(result.evidence.lockStage.pidStatus, 'absent')
      assert.deepEqual(result.allowedDispositions, ['remove'])
    } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('orphan stage malformed bytes remain removable but nonauthoritative', () => {
    const root = fixtureRoot()
    try {
      const target = stageFixture(root, 123, 'a'.repeat(32), Buffer.from('partial', 'utf8'))
      const result = inspectRecovery(request(root, 'orphan-lock-stage', target), { killProcess: absentPid() })
      assert.equal(result.evidence.lockStage.record, null)
      assert.equal(result.evidence.lockStage.pidStatus, 'absent')
    } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('nullable recovery artifacts preserve exact closed POSIX evidence', () => {
    const emptyRoot = fixtureRoot()
    const stageRoot = fixtureRoot()
    const ownerRoot = fixtureRoot()
    const backup = backupFixture()
    try {
      if (process.platform !== 'win32') {
        mkdirSync(join(emptyRoot, RECOVERY_GATE), { mode: 0o700 })
        assert.deepEqual(inspectRecovery(request(emptyRoot, 'stale-recovery-gate', RECOVERY_GATE), { killProcess: absentPid(), platform: 'linux' }).evidence.recoveryGate, { mode: 448, ownerName: null, ownerRawSha256: null, ownerMode: null, ownerStageRawSha256: null, ownerStageMode: null, record: null, pidStatus: null })

        const stageGate = join(stageRoot, RECOVERY_GATE)
        mkdirSync(stageGate, { mode: 0o700 })
        const stageBytes = Buffer.from('partial\n', 'utf8')
        writeFileSync(join(stageGate, 'owner.new'), stageBytes, { mode: 0o600 })
        assert.deepEqual(inspectRecovery(request(stageRoot, 'stale-recovery-gate', RECOVERY_GATE), { killProcess: absentPid(), platform: 'linux' }).evidence.recoveryGate, { mode: 448, ownerName: null, ownerRawSha256: sha256(stageBytes), ownerMode: null, ownerStageRawSha256: sha256(stageBytes), ownerStageMode: 384, record: null, pidStatus: null })

        const ownerGate = join(ownerRoot, RECOVERY_GATE)
        mkdirSync(ownerGate, { mode: 0o700 })
        const owner = gateOwner(ownerRoot)
        writeCanonical(join(ownerGate, 'owner.json'), owner)
        const ownerBytes = Buffer.from(`${canonicalJson(owner)}\n`, 'utf8')
        assert.deepEqual(inspectRecovery(request(ownerRoot, 'stale-recovery-gate', RECOVERY_GATE), { killProcess: absentPid(), platform: 'linux' }).evidence.recoveryGate, { mode: 448, ownerName: 'owner.json', ownerRawSha256: sha256(ownerBytes), ownerMode: 384, ownerStageRawSha256: null, ownerStageMode: null, record: owner, pidStatus: 'absent' })
      }

      rmSync(join(backup.root, backup.target))
      const backupBytes = Buffer.from('backup\n', 'utf8')
      const backupMode = Number(statSync(join(backup.root, ...backup.backupTarget.split('/'))).mode & 0o7777)
      assert.deepEqual(inspectRecovery(request(backup.root, 'abandoned-backup', backup.backupTarget), { currentInspection: { targets: [{ target: backup.target }] }, platform: 'linux', skipTransientLock: true }).evidence.backup, { classification: 'orphan', backupRawSha256: sha256(backupBytes), backupMode, backupContentBase64: backupBytes.toString('base64'), currentTarget: null, currentRawSha256: null, currentMode: null, currentContentBase64: null })
    } finally {
      rmSync(emptyRoot, { force: true, recursive: true })
      rmSync(stageRoot, { force: true, recursive: true })
      rmSync(ownerRoot, { force: true, recursive: true })
      rmSync(backup.root, { force: true, recursive: true })
    }
  })

  test('canonical incomplete lock stages project null records in typed recovery evidence', () => {
    const root = fixtureRoot()
    try {
      const target = stageFixture(root, 123, 'a'.repeat(32), Buffer.from(`${canonicalJson({ ownerNonce: 'a'.repeat(32), pid: 123, protocolVersion: 1 })}\n`, 'utf8'))
      const dispatched = runPrivateDispatcher(Buffer.from(`${canonicalJson(request(root, 'orphan-lock-stage', target))}\n`, 'utf8'), { 'recover-inspect': (value) => inspectRecovery(value, { killProcess: absentPid() }) })
      assert.equal(dispatched.exitCode, 0)
      const result = JSON.parse(dispatched.stdout.toString('utf8'))
      assert.equal(result.evidence.lockStage.record, null)
      assert.equal(result.allowedDispositions[0], 'remove')
    } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('backup recovery evidence uses the approved closed schema without target identity', () => {
    const fixture = backupFixture()
    try {
      const requestValue = request(fixture.root, 'abandoned-backup', fixture.backupTarget)
      const dispatched = runPrivateDispatcher(Buffer.from(`${canonicalJson(requestValue)}\n`, 'utf8'), { 'recover-inspect': (value) => inspectRecovery(value, { currentInspection: { targets: [{ target: fixture.target }] } }) })
      assert.equal(dispatched.exitCode, 0)
      const result = JSON.parse(dispatched.stdout.toString('utf8'))
      assert.deepEqual(Object.keys(result.evidence.backup).sort(), ['backupContentBase64', 'backupMode', 'backupRawSha256', 'classification', 'currentContentBase64', 'currentMode', 'currentRawSha256', 'currentTarget'].sort())
      assert.equal(Object.hasOwn(result.evidence.backup, 'currentIdentity'), false)
    } finally { rmSync(fixture.root, { force: true, recursive: true }) }
  })

  test('orphan stage live pid is blocked', () => {
    const root = fixtureRoot()
    try {
      const target = stageFixture(root)
      assert.throws(() => inspectRecovery(request(root, 'orphan-lock-stage', target), { killProcess: () => {} }), /live|indeterminate|runtime-lock/i)
    } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('orphan stage indeterminate pid is blocked', () => {
    const root = fixtureRoot()
    try {
      const target = stageFixture(root)
      assert.throws(() => inspectRecovery(request(root, 'orphan-lock-stage', target), { killProcess: () => { throw new Error('permission') } }), /live|indeterminate|runtime-lock|filesystem/i)
    } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('special orphan stage is blocked', () => {
    const root = fixtureRoot()
    try {
      const target = `.nightshift-init-backlog.lock.123.${'a'.repeat(32)}.new`
      mkdirSync(join(root, target), { mode: 0o700 })
      assert.throws(() => inspectRecovery(request(root, 'orphan-lock-stage', target), { killProcess: absentPid() }), /ordinary|file|special|filesystem|runtime-lock|inspection failed/i)
    } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('changing orphan stage is blocked', () => {
    const root = fixtureRoot()
    try {
      const target = stageFixture(root)
      const result = inspectRecovery(request(root, 'orphan-lock-stage', target), { killProcess: absentPid() })
      writeFileSync(join(root, target), Buffer.from('changed', 'utf8'))
      assert.throws(() => applyRecovery({ ...request(root, 'orphan-lock-stage', target), operation: 'recover-apply', recoveryInspection: result, disposition: 'remove' }, { killProcess: absentPid() }), /changed|drift|filesystem|recovery/i)
    } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('linked orphan stage is blocked', () => {
    const root = fixtureRoot()
    try {
      const target = `.nightshift-init-backlog.lock.123.${'a'.repeat(32)}.new`
      const source = join(root, 'source')
      writeFileSync(source, Buffer.from('partial', 'utf8'))
      symlinkSync(source, join(root, target))
      assert.throws(() => inspectRecovery(request(root, 'orphan-lock-stage', target), { killProcess: absentPid() }), /link|filesystem|runtime-lock|inspection failed/i)
    } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('invalid orphan stage basename is rejected', () => {
    const root = fixtureRoot()
    try { assert.throws(() => inspectRecovery(request(root, 'orphan-lock-stage', '.nightshift-init-backlog.lock.bad.new'), { killProcess: absentPid() }), /basename|runtime-lock/i) } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('orphan lock stage rejects a leading-zero PID', () => {
    const root = fixtureRoot()
    try {
      const target = `.nightshift-init-backlog.lock.0123.${'a'.repeat(32)}.new`
      writeFileSync(join(root, target), Buffer.from('partial', 'utf8'), { mode: 0o600 })
      assert.throws(() => inspectRecovery(request(root, 'orphan-lock-stage', target), { killProcess: absentPid() }), (error) => error.record?.code === 'runtime-lock' && error.record.phase === 'inspect')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('orphan stage remove replay is already complete', () => {
    const root = fixtureRoot()
    try {
      const target = stageFixture(root)
      const inspected = inspectRecovery(request(root, 'orphan-lock-stage', target), { killProcess: absentPid() })
      const applied = applyRecovery({ ...request(root, 'orphan-lock-stage', target), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'remove' }, { killProcess: absentPid() })
      assert.equal(applied.status, 'completed')
      const replay = applyRecovery({ ...request(root, 'orphan-lock-stage', target), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'remove' }, { killProcess: absentPid() })
      assert.equal(replay.status, 'already-complete')
    } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('approved orphan stage remove deletes only the unchanged stage', () => {
    const root = fixtureRoot()
    try {
      const target = stageFixture(root)
      writeFileSync(join(root, 'unrelated'), Buffer.from('keep', 'utf8'))
      const inspected = inspectRecovery(request(root, 'orphan-lock-stage', target), { killProcess: absentPid() })
      const applied = applyRecovery({ ...request(root, 'orphan-lock-stage', target), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'remove' }, { killProcess: absentPid() })
      assert.equal(applied.status, 'completed')
      assert.equal(existsSync(join(root, target)), false)
      assert.equal(existsSync(join(root, 'unrelated')), true)
    } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('empty recovery gate is recoverable', () => {
    const root = fixtureRoot()
    try {
      mkdirSync(join(root, RECOVERY_GATE), { mode: 0o700 })
      const result = inspectRecovery(request(root, 'stale-recovery-gate', RECOVERY_GATE), { killProcess: absentPid() })
      assert.equal(result.evidence.recoveryGate.ownerName, null)
    } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('published recovery owner pair is recoverable', () => {
    const root = fixtureRoot()
    try {
      const gate = join(root, RECOVERY_GATE)
      mkdirSync(gate, { mode: 0o700 })
      const owner = gateOwner(root)
      writeCanonical(join(gate, 'owner.new'), owner)
      linkSync(join(gate, 'owner.new'), join(gate, 'owner.json'))
      const result = inspectRecovery(request(root, 'stale-recovery-gate', RECOVERY_GATE), { killProcess: absentPid() })
      assert.equal(result.evidence.recoveryGate.pidStatus, 'absent')
    } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('recovery gate cleanup replay is already complete', () => {
    const root = fixtureRoot()
    try {
      const gate = join(root, RECOVERY_GATE)
      mkdirSync(gate, { mode: 0o700 })
      const owner = gateOwner(root)
      writeCanonical(join(gate, 'owner.new'), owner)
      linkSync(join(gate, 'owner.new'), join(gate, 'owner.json'))
      const inspected = inspectRecovery(request(root, 'stale-recovery-gate', RECOVERY_GATE), { killProcess: absentPid() })
      const applyRequest = { ...request(root, 'stale-recovery-gate', RECOVERY_GATE), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'cleanup' }
      assert.equal(applyRecovery(applyRequest, { killProcess: absentPid() }).status, 'completed')
      assert.equal(applyRecovery(applyRequest, { killProcess: absentPid() }).status, 'already-complete')
    } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('stale owner accepts a missing unfinalized directory', () => {
    const root = fixtureRoot()
    try {
      const target = '.nightshift-init-backlog-dir.tmp'
      const owner = ownerFixture(root, { unfinalizedDirectories: [{ mode: process.platform === 'win32' ? null : 0o700, target }] })
      const inspected = inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
      assert.equal(inspected.evidence.owner.directoryStates[0].present, false)
      void owner
    } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('stale owner rejects inherited setgid mode without chmod', () => {
    if (process.platform === 'win32') return
    const root = fixtureRoot()
    try {
      const target = '.nightshift-init-backlog-dir.tmp'
      mkdirSync(join(root, target), { mode: 0o2700 })
      ownerFixture(root, { unfinalizedDirectories: [{ mode: 0o700, target }] })
      assert.throws(() => inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() }), /mode|directory|filesystem/i)
    } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('stale owner rejects a wrong-kind unfinalized directory', () => {
    const root = fixtureRoot()
    try {
      const target = '.nightshift-init-backlog-dir.tmp'
      writeFileSync(join(root, target), Buffer.from('file'))
      ownerFixture(root, { unfinalizedDirectories: [{ mode: process.platform === 'win32' ? null : 0o644, target }] })
      assert.throws(() => inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() }), /directory|invalid|filesystem|inspection failed/i)
    } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('stale owner rejects a linked unfinalized directory', () => {
    const root = fixtureRoot()
    try {
      const target = '.nightshift-init-backlog-dir.tmp'
      mkdirSync(join(root, 'real'), { mode: 0o700 })
      symlinkSync(join(root, 'real'), join(root, target), 'junction')
      ownerFixture(root, { unfinalizedDirectories: [{ mode: process.platform === 'win32' ? null : 0o700, target }] })
      assert.throws(() => inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() }), /link|directory|filesystem|inspection failed/i)
    } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('ordinary inspect reports the ordinal-first valid orphan stage', () => {
    const root = fixtureRoot()
    try {
      const first = stageFixture(root, 123, 'a'.repeat(32))
      const second = stageFixture(root, 124, 'b'.repeat(32))
      const found = discoverInitialLockStages(root, { killProcess: absentPid() })
      assert.deepEqual(found.map((item) => item.name), [first, second].sort())
    } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('ordinary inspect ignores basename-invalid lookalikes', () => {
    const root = fixtureRoot()
    try {
      writeFileSync(join(root, '.nightshift-init-backlog.lock.bad.new'), Buffer.from('ignored'))
      assert.deepEqual(discoverInitialLockStages(root), [])
    } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('orphan discovery never deletes a stage during inspection', () => {
    const root = fixtureRoot()
    try {
      const target = stageFixture(root)
      discoverInitialLockStages(root, { killProcess: absentPid() })
      assert.equal(existsSync(join(root, target)), true)
    } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('recovery inspection performs zero project-target writes', () => {
    const fixture = backupFixture()
    try {
      const before = readFileSync(join(fixture.root, fixture.target))
      backupInspection(fixture)
      assert.deepEqual(readFileSync(join(fixture.root, fixture.target)), before)
    } finally { rmSync(fixture.root, { force: true, recursive: true }) }
  })

  test('partial recovery owner stage is recoverable', () => {
    const root = fixtureRoot()
    try {
      const gate = join(root, RECOVERY_GATE)
      mkdirSync(gate, { mode: 0o700 })
      writeCanonical(join(gate, 'owner.new'), gateOwner(root))
      const result = inspectRecovery(request(root, 'stale-recovery-gate', RECOVERY_GATE), { killProcess: absentPid() })
      assert.equal(result.evidence.recoveryGate.ownerName, null)
      assert.match(result.evidence.recoveryGate.ownerStageRawSha256, /^[a-f0-9]{64}$/)
    } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('published recovery owner without stage is recoverable', () => {
    const root = fixtureRoot()
    try {
      const gate = join(root, RECOVERY_GATE)
      mkdirSync(gate, { mode: 0o700 })
      writeCanonical(join(gate, 'owner.json'), gateOwner(root))
      const result = inspectRecovery(request(root, 'stale-recovery-gate', RECOVERY_GATE), { killProcess: absentPid() })
      assert.equal(result.evidence.recoveryGate.ownerName, 'owner.json')
    } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('stale owner accepts an exact unfinalized directory mode', () => {
    const root = fixtureRoot()
    try {
      const target = '.nightshift-init-backlog-dir.tmp'
      const mode = process.platform === 'win32' ? null : 0o700
      mkdirSync(join(root, target), { mode: mode ?? undefined })
      ownerFixture(root, { unfinalizedDirectories: [{ mode, target }] })
      const result = inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
      assert.equal(result.evidence.owner.directoryStates[0].mode, mode)
    } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('stale owner rejects a noncontiguous present inventory before cleanup mutation', () => {
    const root = fixtureRoot()
    try {
      const first = `.nightshift-init-backlog.${'a'.repeat(64)}.1.tmp`
      const second = `.nightshift-init-backlog.${'a'.repeat(64)}.2.tmp`
      writeFileSync(join(root, second), Buffer.from('second'), { mode: 0o600 })
      ownerFixture(root, { temporaryPaths: [first, second] })
      assert.throws(() => inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() }), /prefix|inventory|contiguous|temporary|runtime|inspection failed/i)
      assert.equal(existsSync(join(root, second)), true)
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('recovery mode evidence follows the injected platform option', () => {
    const ownerRoot = fixtureRoot()
    const gateRoot = fixtureRoot()
    const injectedPlatform = 'win32'
    try {
      const temporary = `.nightshift-init-backlog.${'a'.repeat(64)}.1.tmp`
      ownerFixture(ownerRoot, { temporaryPaths: [temporary] })
      writeFileSync(join(ownerRoot, temporary), Buffer.from('owner'), { mode: 0o600 })
      const ownerEvidence = inspectRecovery(request(ownerRoot, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid(), platform: injectedPlatform }).evidence.owner
      assert.equal(ownerEvidence.mode, null)
      assert.equal(ownerEvidence.temporaryStates[0].mode, null)

      mkdirSync(join(gateRoot, RECOVERY_GATE), { mode: 0o700 })
      const gateEvidence = inspectRecovery(request(gateRoot, 'stale-recovery-gate', RECOVERY_GATE), { killProcess: absentPid(), platform: injectedPlatform }).evidence.recoveryGate
      assert.equal(gateEvidence.mode, null)
    } finally {
      rmSync(ownerRoot, { force: true, recursive: true })
      rmSync(gateRoot, { force: true, recursive: true })
    }
  })

  test('external-writer directory race is rejected without mutation', () => {
    const root = fixtureRoot()
    try {
      const target = '.nightshift-init-backlog-dir.tmp'
      mkdirSync(join(root, target), { mode: 0o700 })
      ownerFixture(root, { unfinalizedDirectories: [{ mode: 0o700, target }] })
      chmodSync(join(root, target), 0o755)
      assert.throws(() => inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() }), /mode|changed|directory|inspection failed/i)
      assert.equal(existsSync(join(root, target)), true)
    } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('stale owner removes its lock last and retains it on cleanup failure', () => {
    const root = fixtureRoot()
    try {
      const temp = `.nightshift-init-backlog.${'a'.repeat(64)}.1.tmp`
      writeFileSync(join(root, temp), Buffer.from('temp'), { mode: 0o600 })
      ownerFixture(root, { temporaryPaths: [temp] })
      const inspected = inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
      assert.throws(() => applyRecovery({ ...request(root, 'stale-owner', '.nightshift-init-backlog.lock'), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'cleanup' }, { killProcess: absentPid(), removeAndVerify: () => { throw new Error('cleanup failure') } }), /cleanup|filesystem|recovery/i)
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), true)
    } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('ordinary inspect reports no orphan stage when none exists', () => {
    const root = fixtureRoot()
    try { assert.deepEqual(discoverInitialLockStages(root), []) } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('ordinary inspect reports the malformed orphan stage for recovery', () => {
    const root = fixtureRoot()
    try {
      const target = stageFixture(root, 123, 'a'.repeat(32), Buffer.from('malformed', 'utf8'))
      const found = discoverInitialLockStages(root, { killProcess: absentPid() })
      assert.equal(found[0].name, target)
    } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('ordinary inspect reports multiple orphan stages across fresh inspections', () => {
    const root = fixtureRoot()
    try {
      stageFixture(root, 123)
      stageFixture(root, 124, 'b'.repeat(32))
      assert.equal(discoverInitialLockStages(root, { killProcess: absentPid() }).length, 2)
    } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('recovery capacity admits 64 actions', () => {
    const fixture = unwrapFixture(64)
    try {
      fixture.applyRequest.actions.sort((left, right) => left.target.localeCompare(right.target))
      const result = publishApply(fixture.applyRequest, { currentInspection: fixture.carried, collectInspection: () => fixture.post })
      assert.equal(result.retainedBackups.length, 0)
      assert.equal(result.outcomes.length, 64)
    } finally { rmSync(fixture.root, { force: true, recursive: true }) }
  })

  test('recovery capacity admits near-limit reserved paths', () => {
    const root = fixtureRoot()
    try {
      const paths = Array.from({ length: 63 }, (_, index) => `.nightshift-init-backlog.${'a'.repeat(64)}.${index + 1}.tmp`)
      paths.sort()
      ownerFixture(root, { temporaryPaths: paths })
      const result = inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
      assert.equal(result.evidence.owner.temporaryStates.length, 63)
    } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('recovery inspection returns payload-too-large before approval', () => {
    const fixture = backupFixture('FEATURES.md', 'a'.repeat(2 * 1024 * 1024), 'current\n')
    try {
      assert.throws(() => inspectRecovery(request(fixture.root, 'abandoned-backup', fixture.backupTarget), { currentInspection: { targets: [{ target: fixture.target }] } }), /payload|size/i)
    } finally { rmSync(fixture.root, { force: true, recursive: true }) }
  })

  test('recovery inspection rejects an allowed apply envelope above the request limit', () => {
    const fixture = markerFixture()
    try {
      const baseRequest = { ...request(fixture.root, 'election-marker', fixture.marker), host: 'codex', hostContext: codexContext() }
      const currentInspection = { git: { kind: 'git', freshScaffold: true } }
      const baseInspection = inspectRecovery(baseRequest, { currentInspection, skipTransientLock: true })
      const inspectionFor = (instructionLength) => {
        const context = codexContext(['x'.repeat(instructionLength)])
        const inspection = { ...baseInspection, hostContext: context, recoveryId: null }
        inspection.recoveryId = deriveRecoveryId(inspection)

        return { inspection, request: { ...baseRequest, hostContext: context } }
      }
      const envelopeSize = (instructionLength, disposition) => {
        const item = inspectionFor(instructionLength)

        return canonicalBytes(recoveryApplyEnvelope(item.request, item.inspection, disposition)).length
      }
      let low = 0
      let high = 700000
      while (low + 1 < high) {
        const middle = Math.floor((low + high) / 2)
        if (envelopeSize(middle, 'deferred') <= MAX_RECOVERY_REQUEST_BYTES) low = middle
        else high = middle
      }
      const candidate = inspectionFor(high)
      assert.ok(envelopeSize(high, 'deferred') > MAX_RECOVERY_REQUEST_BYTES)
      assert.ok(envelopeSize(low, 'deferred') <= MAX_RECOVERY_REQUEST_BYTES)
      assert.ok(envelopeSize(high, 'track') <= envelopeSize(high, 'deferred'))
      assert.ok(envelopeSize(high, 'ignore') <= envelopeSize(high, 'deferred'))
      assert.ok(envelopeSize(high, 'abandon') <= envelopeSize(high, 'deferred'))
      assert.throws(() => inspectRecovery(candidate.request, { currentInspection, skipTransientLock: true }), (error) => error.record?.code === 'payload-too-large' && error.record.phase === 'inspect' && error.record.operation === 'recover-inspect')
    } finally { rmSync(fixture.root, { force: true, recursive: true }) }
  })

  test('stale owner rejects an inventoried ordinary project file before cleanup', () => {
    const root = fixtureRoot()
    try {
      writeFileSync(join(root, 'README.md'), Buffer.from('must survive\n'), { mode: 0o600 })
      ownerFixture(root, { temporaryPaths: ['README.md'] })
      assert.throws(() => inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() }), /runtime-lock|malformed|temporary|inspection failed/i)
      assert.equal(existsSync(join(root, 'README.md')), true)
    } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('stale owner cleanup claims the recovery gate before removing its inventory', () => {
    const root = fixtureRoot()
    try {
      ownerFixture(root)
      const inspected = inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
      const applyRequest = { ...request(root, 'stale-owner', '.nightshift-init-backlog.lock'), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'cleanup' }
      let gateObserved = false
      const remove = (path, options) => {
        if (path.endsWith('.nightshift-init-backlog.lock')) gateObserved = existsSync(join(root, RECOVERY_GATE))
        return require('../../skills/init-backlog/lib/filesystem').removeAndVerify(path, options)
      }
      assert.equal(applyRecovery(applyRequest, { killProcess: absentPid(), removeAndVerify: remove }).status, 'completed')
      assert.equal(gateObserved, true)
      assert.equal(existsSync(join(root, RECOVERY_GATE)), false)
    } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('backup restore accepts carried target replacement when bytes and mode are unchanged', () => {
    const fixture = backupFixture('FEATURES.md', 'backup\n', 'current\n')
    try {
      const inspected = backupInspection(fixture)
      const targetPath = join(fixture.root, fixture.target)
      rmSync(targetPath)
      writeFileSync(targetPath, Buffer.from('current\n', 'utf8'), { mode: 0o644 })

      const applied = applyRecovery({ ...request(fixture.root, 'abandoned-backup', fixture.backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'restore' })
      assert.equal(applied.status, 'completed')
      assert.equal(readFileSync(targetPath, 'utf8'), 'backup\n')
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('published recovery owner requires one complete same-inode two-link owner pair', () => {
    const root = fixtureRoot()
    try {
      const gate = join(root, RECOVERY_GATE)
      mkdirSync(gate, { mode: 0o700 })
      const owner = gateOwner(root)
      writeCanonical(join(gate, 'owner.new'), owner)
      linkSync(join(gate, 'owner.new'), join(gate, 'owner.json'))

      const result = inspectRecovery(request(root, 'stale-recovery-gate', RECOVERY_GATE), { killProcess: absentPid() })
      assert.equal(result.evidence.recoveryGate.ownerName, 'owner.json')
      assert.equal(result.evidence.recoveryGate.record.operation, 'recover-apply')
      rmSync(gate, { force: true, recursive: true })
      mkdirSync(gate, { mode: 0o700 })
      writeCanonical(join(gate, 'owner.new'), { operation: 'recover-apply' })
      linkSync(join(gate, 'owner.new'), join(gate, 'owner.json'))
      assert.throws(() => inspectRecovery(request(root, 'stale-recovery-gate', RECOVERY_GATE), { killProcess: absentPid() }), /malformed|owner|schema|inspection failed/i)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('raw recovery dispatch collects current target mapping and Git policy without injected inspection', () => {
    const fixture = backupFixture('FEATURES.md', 'backup\n', 'current\n')
    try {
      const recoveryRequest = request(fixture.root, 'abandoned-backup', fixture.backupTarget)
      const dispatched = runPrivateDispatcher(Buffer.from(`${canonicalJson(recoveryRequest)}\n`, 'utf8'), { 'recover-inspect': (value) => inspectRecovery(value, { collectInspection: () => ({ git: { kind: 'non-git', objectFormat: null, freshScaffold: false, plansPolicy: 'not-applicable', trackedPlanPaths: [], trackedBacklogPaths: [], nonPlanIgnoreMatches: [], nonPlanUnignoredPaths: [], newlinePolicies: [] }, targets: [{ target: fixture.target }] }) }) })
      assert.equal(dispatched.exitCode, 0)
      const result = JSON.parse(dispatched.stdout.toString('utf8'))
      assert.equal(result.ok, true)
      assert.equal(result.evidence.backup.currentTarget, fixture.target)
      assert.equal(result.evidence.backup.classification, 'divergent')
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('oversized marker fails with typed payload-too-large recovery record before embedding', () => {
    const root = fixtureRoot()
    try {
      writeFileSync(join(root, ELECTION_MARKER_PATH), Buffer.alloc(65537, 0x61), { mode: 0o600 })
      assert.throws(() => inspectRecovery(request(root, 'election-marker', ELECTION_MARKER_PATH), { currentInspection: { git: { kind: 'git' } } }), (error) => error.record?.code === 'payload-too-large' && error.record.phase === 'inspect')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('marker recovery classifies the stable file-too-large code independently of diagnostic wording', () => {
    const root = fixtureRoot()
    try {
      const capacityError = new Error('capacity exhausted')
      capacityError.code = 'file-too-large'
      const artifactOpenFile = () => { throw capacityError }

      assert.throws(() => inspectRecovery(request(root, 'election-marker', ELECTION_MARKER_PATH), { artifactOpenFile, currentInspection: { git: { kind: 'git' } } }), (error) => error.record?.code === 'payload-too-large' && error.cause === capacityError)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('oversized mechanical backup fails with typed payload-too-large recovery record before embedding', () => {
    const fixture = backupFixture('FEATURES.md', 'b'.repeat(MAX_MECHANICAL_FILE_BYTES + 1), 'current\n')
    try {
      assert.throws(() => inspectRecovery(request(fixture.root, 'abandoned-backup', fixture.backupTarget), { currentInspection: { targets: [{ target: fixture.target }] } }), (error) => error.record?.code === 'payload-too-large' && error.record.phase === 'inspect')
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('matched backup current target is bounded independently at the mechanical limit', () => {
    const exact = backupFixture('FEATURES.md', 'backup\n', 'c'.repeat(MAX_MECHANICAL_FILE_BYTES))
    try {
      const inspected = backupInspection(exact)
      assert.equal(Buffer.from(inspected.evidence.backup.currentContentBase64, 'base64').length, MAX_MECHANICAL_FILE_BYTES)
      const dispatched = runPrivateDispatcher(Buffer.from(`${canonicalJson(request(exact.root, 'abandoned-backup', exact.backupTarget))}\n`, 'utf8'), { 'recover-inspect': (value) => inspectRecovery(value, { currentInspection: { targets: [{ target: exact.target }] } }) })
      assert.equal(dispatched.exitCode, 0)
      assert.equal(JSON.parse(dispatched.stdout.toString('utf8')).ok, true)
    } finally { rmSync(exact.root, { force: true, recursive: true }) }

    const oversized = backupFixture('FEATURES.md', 'backup\n', 'd'.repeat(MAX_MECHANICAL_FILE_BYTES + 1))
    try {
      const dispatched = runPrivateDispatcher(Buffer.from(`${canonicalJson(request(oversized.root, 'abandoned-backup', oversized.backupTarget))}\n`, 'utf8'), { 'recover-inspect': (value) => inspectRecovery(value, { currentInspection: { targets: [{ target: oversized.target }] } }) })
      assert.equal(dispatched.exitCode, 1)
      const result = JSON.parse(dispatched.stdout.toString('utf8'))
      assert.equal(result.code, 'payload-too-large')
      assert.equal(result.operation, 'recover-inspect')
      assert.equal(result.phase, 'inspect')
    } finally { rmSync(oversized.root, { force: true, recursive: true }) }
  })

  test('recovery apply preserves the mechanical byte ceiling after inspection', () => {
    for (const extraBytes of [0, 1]) {
      const fixture = backupFixture()
      try {
        const inspected = backupInspection(fixture)
        writeFileSync(join(fixture.root, fixture.target), Buffer.alloc(MAX_MECHANICAL_FILE_BYTES + extraBytes, 0x61), { mode: 0o644 })

        assert.throws(
          () => applyRecovery({ ...request(fixture.root, 'abandoned-backup', fixture.backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'accept' }),
          (error) => extraBytes === 0 ? !causeChainHasCode(error, 'file-too-large') : causeChainHasCode(error, 'file-too-large'),
        )
      } finally {
        rmSync(fixture.root, { force: true, recursive: true })
      }
    }
  })

  test('restore failure returns typed recovery status, retained backups, and manual cleanup warning', () => {
    const fixture = backupFixture()
    try {
      const inspected = backupInspection(fixture)
      assert.throws(() => applyRecovery({ ...request(fixture.root, 'abandoned-backup', fixture.backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'restore' }, { renameSync: () => { throw new Error('restore failure') } }), (error) => error.record?.recovery?.status === 'restore-failed' && error.record.recovery.retainedBackups.includes(fixture.backupTarget) && error.record.recovery.warnings.some((warning) => warning.code === 'manual-cleanup') && !error.record.detail.includes('restore failure'))
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('unattended recover-apply rejects a legal restore disposition without captured authority', () => {
    const fixture = backupFixture()
    try {
      const inspected = backupInspection(fixture)
      assert.throws(() => applyRecovery({ ...request(fixture.root, 'abandoned-backup', fixture.backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'restore' }, { unattended: true }), /authority|unattended/i)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('backup recovery response loss covers restore, accept, remove, terminal replay, and absent backup', () => {
    const cases = [
      { disposition: 'restore', currentByte: 'current\n', expectedByte: 'backup\n' },
      { disposition: 'accept', currentByte: 'current\n', expectedByte: 'current\n' },
      { disposition: 'remove', currentByte: 'backup\n', expectedByte: 'backup\n' },
    ]
    for (const item of cases) {
      const fixture = backupFixture('FEATURES.md', 'backup\n', item.currentByte)
      try {
        const inspected = backupInspection(fixture)
        assert.ok(inspected.allowedDispositions.includes(item.disposition))
        if (item.disposition === 'restore') {
          const result = applyRecovery({ ...request(fixture.root, 'abandoned-backup', fixture.backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: item.disposition })
          assert.equal(result.status, 'completed')
        } else {
          assert.equal(applyRecovery({ ...request(fixture.root, 'abandoned-backup', fixture.backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: item.disposition }).status, 'completed')
        }
      } finally {
        rmSync(fixture.root, { force: true, recursive: true })
      }
    }

    const redundant = backupFixture('FEATURES.md', 'same\n', 'same\n')
    try {
      const inspected = backupInspection(redundant)
      assert.deepEqual(inspected.allowedDispositions, ['remove'])
      const result = applyRecovery({ ...request(redundant.root, 'abandoned-backup', redundant.backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'remove' })
      assert.equal(result.status, 'completed')
      assert.equal(existsSync(join(redundant.root, ...redundant.backupTarget.split('/'))), false)
      assert.equal(applyRecovery({ ...request(redundant.root, 'abandoned-backup', redundant.backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'remove' }).status, 'already-complete')
    } finally {
      rmSync(redundant.root, { force: true, recursive: true })
    }

    const absent = backupFixture()
    try {
      const inspected = backupInspection(absent)
      rmSync(join(absent.root, ...absent.backupTarget.split('/')))
      assert.equal(applyRecovery({ ...request(absent.root, 'abandoned-backup', absent.backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'accept' }).status, 'already-complete')
    } finally {
      rmSync(absent.root, { force: true, recursive: true })
    }
  })

  test('backup restore response loss resumes when the target is restored before or after backup deletion', () => {
    const beforeBackupDeletion = backupFixture()
    try {
      const inspected = backupInspection(beforeBackupDeletion)
      const backupPath = join(beforeBackupDeletion.root, ...beforeBackupDeletion.backupTarget.split('/'))
      const targetPath = join(beforeBackupDeletion.root, beforeBackupDeletion.target)
      let responseLoss
      assert.throws(() => applyRecovery({ ...request(beforeBackupDeletion.root, 'abandoned-backup', beforeBackupDeletion.backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'restore' }, { onRenamed: (destination) => { if (destination === targetPath) throw new Error('response loss') } }), (error) => { responseLoss = error; return error.record?.code === 'restore-failed' && error.record.phase === 'restore' })
      assert.equal(responseLoss.record.code, 'restore-failed')
      assert.deepEqual(readFileSync(targetPath), Buffer.from('backup\n', 'utf8'))
      assert.equal(existsSync(backupPath), true)
      const resumed = applyRecovery({ ...request(beforeBackupDeletion.root, 'abandoned-backup', beforeBackupDeletion.backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'restore' })
      assert.equal(resumed.status, 'completed')
      assert.deepEqual(readFileSync(targetPath), Buffer.from('backup\n', 'utf8'))
      assert.equal(existsSync(backupPath), false)
    } finally {
      rmSync(beforeBackupDeletion.root, { force: true, recursive: true })
    }

    const afterBackupDeletion = backupFixture()
    try {
      const inspected = backupInspection(afterBackupDeletion)
      const backupPath = join(afterBackupDeletion.root, ...afterBackupDeletion.backupTarget.split('/'))
      const targetPath = join(afterBackupDeletion.root, afterBackupDeletion.target)
      let responseLoss
      assert.throws(() => applyRecovery({ ...request(afterBackupDeletion.root, 'abandoned-backup', afterBackupDeletion.backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'restore' }, { onRenamed: (destination) => { if (destination === targetPath) { rmSync(backupPath); throw new Error('response loss') } } }), (error) => { responseLoss = error; return error.record?.code === 'restore-failed' && error.record.phase === 'restore' })
      assert.equal(responseLoss.record.code, 'restore-failed')
      assert.deepEqual(readFileSync(targetPath), Buffer.from('backup\n', 'utf8'))
      assert.equal(existsSync(backupPath), false)
      const resumed = applyRecovery({ ...request(afterBackupDeletion.root, 'abandoned-backup', afterBackupDeletion.backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'restore' })
      assert.equal(resumed.status, 'already-complete')
      assert.deepEqual(readFileSync(targetPath), Buffer.from('backup\n', 'utf8'))
      assert.equal(existsSync(backupPath), false)
    } finally {
      rmSync(afterBackupDeletion.root, { force: true, recursive: true })
    }
  })

  test('backup restore reports cleanup-failed when removal fails after target publication', () => {
    const fixture = backupFixture()
    try {
      const inspected = backupInspection(fixture)
      const backupPath = join(fixture.root, ...fixture.backupTarget.split('/'))
      const targetPath = join(fixture.root, fixture.target)
      const filesystem = require('../../skills/init-backlog/lib/filesystem')
      assert.throws(() => applyRecovery({ ...request(fixture.root, 'abandoned-backup', fixture.backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'restore' }, { removeAndVerify: (path, options) => {
        if (path === backupPath) throw new Error('backup removal failure')

        return filesystem.removeAndVerify(path, options)
      } }), (error) => error.record?.code === 'cleanup-failed' && error.record.phase === 'cleanup' && error.record.recovery?.status === 'cleanup-failed' && error.record.recovery.retainedBackups.includes(fixture.backupTarget) && error.record.recovery.warnings.some((warning) => warning.code === 'manual-cleanup'))
      assert.deepEqual(readFileSync(targetPath), Buffer.from('backup\n', 'utf8'))
      assert.equal(existsSync(backupPath), true)
      assert.equal(applyRecovery({ ...request(fixture.root, 'abandoned-backup', fixture.backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'restore' }).status, 'completed')
      assert.equal(existsSync(backupPath), false)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('marker recovery response loss resumes every disposition and recognizes replacement or absence', () => {
    for (const disposition of ['deferred', 'track', 'ignore']) {
      const fixture = markerFixture()
      try {
        const inspected = inspectRecovery(request(fixture.root, 'election-marker', fixture.marker), { currentInspection: { git: { kind: 'git', freshScaffold: true } } })
        assert.ok(inspected.allowedDispositions.includes(disposition))
        assert.deepEqual(inspected.allowedDispositions, ['deferred', 'track', 'ignore', 'abandon'])
      } finally {
        rmSync(fixture.root, { force: true, recursive: true })
      }
    }

    const abandoned = markerFixture()
    try {
      const inspected = inspectRecovery(request(abandoned.root, 'election-marker', abandoned.marker), { currentInspection: { git: { kind: 'git', freshScaffold: true } } })
      const result = applyRecovery({ ...request(abandoned.root, 'election-marker', abandoned.marker), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'abandon' })
      assert.equal(result.status, 'completed')
      assert.equal(applyRecovery({ ...request(abandoned.root, 'election-marker', abandoned.marker), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'abandon' }).status, 'already-complete')
    } finally {
      rmSync(abandoned.root, { force: true, recursive: true })
    }
  })

  test('recover inspection collects target and Git policy twice and detects drift', () => {
    const fixture = backupFixture()
    try {
      let collections = 0
      assert.throws(() => inspectRecovery(request(fixture.root, 'abandoned-backup', fixture.backupTarget), { collectInspection: () => {
        collections += 1
        if (collections === 2) writeFileSync(join(fixture.root, fixture.target), Buffer.from('drifted\n', 'utf8'))

        return { git: { kind: 'non-git', freshScaffold: false }, targets: [{ target: fixture.target }], collection: collections }
      } }), /snapshot-drift/i)
      assert.equal(collections, 2)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('raw recover apply performs a fresh policy collection without injected current inspection', () => {
    const fixture = backupFixture('FEATURES.md', 'same\n', 'same\n')
    try {
      chmodSync(join(fixture.root, fixture.target), 0o600)
      const inspected = backupInspection(fixture)
      let collections = 0
      const raw = { host: 'claude-code', hostContext: hostContext(), operation: 'recover-apply', protocolVersion: 1, recoveryInspection: inspected, disposition: 'remove', root: fixture.root }
      const dispatched = runPrivateDispatcher(Buffer.from(`${canonicalJson(raw)}\n`, 'utf8'), { 'recover-apply': (value) => applyRecovery(value, { collectInspection: () => { collections += 1; return { git: { kind: 'non-git', freshScaffold: false }, targets: [{ target: fixture.target }] } } }) })
      assert.equal(dispatched.exitCode, 0, `${dispatched.stdout.toString('utf8')} ${dispatched.stderr.toString('utf8')}`)
      assert.equal(collections, 2)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('typed recovery failures serialize with exact recovery evidence and no internal exit', () => {
    const fixture = backupFixture()
    try {
      const inspected = backupInspection(fixture)
      const raw = { host: 'claude-code', hostContext: hostContext(), operation: 'recover-apply', protocolVersion: 1, recoveryInspection: inspected, disposition: 'restore', root: fixture.root }
      const dispatched = runPrivateDispatcher(Buffer.from(`${canonicalJson(raw)}\n`, 'utf8'), { 'recover-apply': (value) => applyRecovery(value, { renameSync: () => { throw new Error('restore failure') } }) })
      assert.equal(dispatched.exitCode, 1, `${dispatched.stdout.toString('utf8')} ${dispatched.stderr.toString('utf8')}`)
      const record = JSON.parse(dispatched.stdout.toString('utf8'))
      assert.deepEqual(Object.keys(record.recovery).sort(), ['retainedBackups', 'status', 'warnings'].sort())
      assert.equal(record.recovery.status, 'restore-failed')
      assert.deepEqual(record.recovery.retainedBackups, [fixture.backupTarget])
      validateResultRecord(record)
      assert.deepEqual(encodeResult(record), dispatched.stdout)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('recovery result paths use code-point ordinal ordering through validation and serialization', () => {
    const fixture = backupFixture()
    try {
      const bmp = `a/${String.fromCodePoint(0xe000)}`
      const nonBmp = `a/${String.fromCodePoint(0x10000)}`
      const result = { changedPaths: [bmp, nonBmp], disposition: 'remove', host: 'claude-code', hostContext: hostContext(), ok: true, operation: 'recover-apply', protocolVersion: 1, recoveryId: 'a'.repeat(64), recoveryKind: 'abandoned-backup', recoveryTarget: fixture.backupTarget, retainedPaths: [bmp, nonBmp], root: fixture.root, status: 'completed', warnings: [] }
      assert.doesNotThrow(() => validateResultRecord(result))
      assert.doesNotThrow(() => encodeResult(result))
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('redundant backup remove reaches injected cleanup failure and returns cleanup-failed evidence', () => {
    const fixture = backupFixture('FEATURES.md', 'same\n', 'same\n')
    try {
      const inspected = backupInspection(fixture)
      assert.deepEqual(inspected.allowedDispositions, ['remove'])
      assert.throws(() => applyRecovery({ ...request(fixture.root, 'abandoned-backup', fixture.backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'remove' }, { removeAndVerify: (path, options) => { if (path.endsWith('.bak')) throw new Error('cleanup failure'); require('../../skills/init-backlog/lib/filesystem').removeAndVerify(path, options) } }), (error) => error.record?.code === 'cleanup-failed' && error.record.recovery.status === 'cleanup-failed' && error.record.recovery.retainedBackups[0] === fixture.backupTarget)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('terminal backup replay refreshes policy and rejects a successor before completion', () => {
    const fixture = backupFixture('FEATURES.md', 'same\n', 'same\n')
    try {
      const inspected = backupInspection(fixture)
      applyRecovery({ ...request(fixture.root, 'abandoned-backup', fixture.backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'remove' })
      let collections = 0
      const current = { git: { kind: 'non-git' }, targets: [{ target: fixture.target }] }
      const collect = () => { collections += 1; return current }
      const replay = applyRecovery({ ...request(fixture.root, 'abandoned-backup', fixture.backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'remove' }, { collectInspection: collect })
      assert.equal(replay.status, 'already-complete')
      assert.equal(collections, 2)
      writeFileSync(join(fixture.root, ...fixture.backupTarget.split('/')), Buffer.from('successor\n', 'utf8'), { mode: 0o600 })
      assert.throws(() => applyRecovery({ ...request(fixture.root, 'abandoned-backup', fixture.backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'remove' }, { collectInspection: collect }), /changed|snapshot|link|publication/i)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('terminal marker replay refreshes policy before completion', () => {
    const fixture = markerFixture()
    try {
      const inspected = inspectRecovery(request(fixture.root, 'election-marker', fixture.marker), { currentInspection: { git: { kind: 'git', freshScaffold: false } } })
      applyRecovery({ ...request(fixture.root, 'election-marker', fixture.marker), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'abandon' }, { currentInspection: { git: { kind: 'git', freshScaffold: false } } })
      let collections = 0
      const current = { git: { kind: 'git', freshScaffold: false }, targets: [] }
      const replay = applyRecovery({ ...request(fixture.root, 'election-marker', fixture.marker), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'abandon' }, { collectInspection: () => { collections += 1; return current } })
      assert.equal(replay.status, 'already-complete')
      assert.equal(collections, 2)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('recovery replacement rechecks expected identity immediately before rename', () => {
    const root = fixtureRoot()
    const target = join(root, 'target.md')
    const temporary = join(root, 'target.recovery.tmp')
    try {
      writeFileSync(target, Buffer.from('before\n', 'utf8'), { mode: 0o600 })
      const expected = stableOpenFile(root, target, { requireSingleLink: true })
      assert.throws(() => publishRecoveryFile(root, target, Buffer.from('after\n', 'utf8'), expected.mode, { expected, temporary, onBeforeRename: () => writeFileSync(target, Buffer.from('successor\n', 'utf8'), { mode: 0o600 }), renameSync }), /changed|identity/i)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('stale-owner cleanup rejects a recovery gate it did not claim', () => {
    const root = fixtureRoot()
    try {
      ownerFixture(root)
      const inspected = inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
      mkdirSync(join(root, RECOVERY_GATE), { mode: 0o700 })
      assert.throws(() => applyRecovery({ ...request(root, 'stale-owner', '.nightshift-init-backlog.lock'), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'cleanup' }, { killProcess: absentPid() }), (error) => error.record?.code === 'runtime-lock' && error.record.phase === 'lock')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('recovery gate ownership uses a nonzero injected or generated nonce', () => {
    const root = fixtureRoot()
    try {
      ownerFixture(root)
      const inspected = inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
      assert.throws(() => applyRecovery({ ...request(root, 'stale-owner', '.nightshift-init-backlog.lock'), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'cleanup' }, { killProcess: absentPid(), onTransition: (point) => { if (point === 'after-recovery-gate-owner-publish') throw new Error('stop') } }), /filesystem|publication|stop/i)
      const owner = JSON.parse(readFileSync(join(root, RECOVERY_GATE, 'owner.json'), 'utf8'))
      assert.notEqual(owner.ownerNonce, '0'.repeat(32))
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('invalid recovery gate owner records fail closed before evidence succeeds', () => {
    const root = fixtureRoot()
    try {
      const gate = join(root, RECOVERY_GATE)
      const stage = join(gate, 'owner.new')
      mkdirSync(gate, { mode: 0o700 })
      writeCanonical(stage, { ...gateOwner(root), extra: true })
      linkSync(stage, join(gate, 'owner.json'))
      assert.throws(() => inspectRecovery(request(root, 'stale-recovery-gate', RECOVERY_GATE), { killProcess: absentPid() }), (error) => error.record?.code === 'runtime-lock' && error.record.phase === 'lock' && error.record.target === RECOVERY_GATE)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('live recovery residue uses the declared lock phase and code', () => {
    const root = fixtureRoot()
    try {
      const target = stageFixture(root)
      assert.throws(() => inspectRecovery(request(root, 'orphan-lock-stage', target), { killProcess: () => undefined }), (error) => error.record?.code === 'runtime-lock' && error.record.phase === 'lock')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('unattended recovery authority failure uses the declared recovery-invalid code', () => {
    const fixture = backupFixture()
    try {
      const inspected = backupInspection(fixture)
      assert.throws(() => applyRecovery({ ...request(fixture.root, 'abandoned-backup', fixture.backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'restore' }, { unattended: true }), (error) => error.record?.code === 'recovery-invalid' && error.record.phase === 'prevalidate')
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('recovery success paths use code-point ordinal ordering from the real cleanup result', () => {
    const root = fixtureRoot()
    const privateUse = String.fromCodePoint(0xe000)
    const astral = String.fromCodePoint(0x10000)
    const paths = [`${privateUse}/.nightshift-init-backlog.${'a'.repeat(64)}.1.tmp`, `${astral}/.nightshift-init-backlog.${'a'.repeat(64)}.2.tmp`].sort(compareOrdinal)
    try {
      const { lock } = ownerFixture(root, { temporaryPaths: paths })
      for (const target of paths) {
        mkdirSync(join(root, target.slice(0, target.lastIndexOf('/'))), { mode: 0o700 })
        writeFileSync(join(root, ...target.split('/')), Buffer.from(target, 'utf8'), { mode: 0o600 })
      }
      const inspected = inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
      const result = applyRecovery({ ...request(root, 'stale-owner', '.nightshift-init-backlog.lock'), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'cleanup' }, { killProcess: absentPid() })
      assert.deepEqual(result.changedPaths, ['.nightshift-init-backlog.lock', ...paths].sort(compareOrdinal))
      void lock
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('transient recovery lock rejects a recovery gate appearing after lock readback', () => {
    const root = fixtureRoot()
    try {
      const target = stageFixture(root)
      assert.throws(() => inspectRecovery(request(root, 'orphan-lock-stage', target), { killProcess: absentPid(), onPublished: () => mkdirSync(join(root, RECOVERY_GATE), { mode: 0o700 }) }), (error) => error.record?.code === 'runtime-lock' && error.record.phase === 'lock')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('stale-owner cleanup refuses a matching recovery gate with a live owner', () => {
    const root = fixtureRoot()
    try {
      ownerFixture(root)
      const inspected = inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
      const gate = join(root, RECOVERY_GATE)
      mkdirSync(gate, { mode: 0o700 })
      writeCanonical(join(gate, 'owner.json'), { ...gateOwner(root, 322), recoveryId: inspected.recoveryId })
      const applyRequest = { ...request(root, 'stale-owner', '.nightshift-init-backlog.lock'), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'cleanup' }

      const killProcess = (pid) => { if (pid === 321) { const error = new Error('absent'); error.code = 'ESRCH'; throw error } }
      assert.throws(() => applyRecovery(applyRequest, { killProcess }), (error) => error.record?.code === 'runtime-lock' && error.record.phase === 'lock')
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), true)
      assert.equal(existsSync(join(gate, 'owner.json')), true)
    } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('stale-owner cleanup revalidates the carried lock after claiming the gate', () => {
    const root = fixtureRoot()
    const temporary = `.nightshift-init-backlog.${'a'.repeat(64)}.1.tmp`
    try {
      ownerFixture(root, { temporaryPaths: [temporary] })
      writeFileSync(join(root, temporary), Buffer.from('temporary', 'utf8'), { mode: 0o600 })
      const inspected = inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
      const successor = { createdAtUnixMs: 0, manifestId: 'a'.repeat(64), operation: 'apply', ownerNonce: 'e'.repeat(32), pid: 321, protocolVersion: 1, recoveryId: null, root, temporaryPaths: [], unfinalizedDirectories: [] }
      const applyRequest = { ...request(root, 'stale-owner', '.nightshift-init-backlog.lock'), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'cleanup' }
      assert.throws(() => applyRecovery(applyRequest, { killProcess: absentPid(), onTransition: (point) => { if (point === 'after-recovery-gate-owner-publish') writeCanonical(join(root, '.nightshift-init-backlog.lock'), successor) } }), (error) => error.record?.code === 'snapshot-drift' && error.record.phase === 'prevalidate')
      assert.equal(JSON.parse(readFileSync(join(root, '.nightshift-init-backlog.lock'), 'utf8')).ownerNonce, 'e'.repeat(32))
      assert.equal(existsSync(join(root, temporary)), true)
      assert.equal(existsSync(join(root, RECOVERY_GATE, 'owner.json')), true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('transient recovery lock rejects a successor before backup or marker subject mutation', () => {
    const cases = [
      () => {
        const fixture = backupFixture()
        const inspected = backupInspection(fixture)
        return { fixture, inspected, disposition: 'restore', subjectPaths: [fixture.target, fixture.backupTarget], subjectBytes: [readFileSync(join(fixture.root, fixture.target)), readFileSync(join(fixture.root, ...fixture.backupTarget.split('/')))], request: { ...request(fixture.root, 'abandoned-backup', fixture.backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'restore' } }
      },
      () => {
        const fixture = markerFixture()
        const inspected = inspectRecovery(request(fixture.root, 'election-marker', fixture.marker), { currentInspection: { git: { kind: 'git', freshScaffold: true } } })
        return { fixture, inspected, disposition: 'track', subjectPaths: [fixture.marker], subjectBytes: [readFileSync(join(fixture.root, fixture.marker))], request: { ...request(fixture.root, 'election-marker', fixture.marker), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'track' } }
      },
    ]
    for (const makeCase of cases) {
      const item = makeCase()
      try {
        assert.throws(() => applyRecovery(item.request, { onTemporaryStaged: () => { ownerFixture(item.fixture.root, { ownerNonce: 'e'.repeat(32) }) } }), (error) => error.record?.code === 'snapshot-drift' && error.record.phase === 'prevalidate')
        for (let index = 0; index < item.subjectPaths.length; index += 1) assert.deepEqual(readFileSync(join(item.fixture.root, ...item.subjectPaths[index].split('/'))), item.subjectBytes[index])
      } finally {
        rmSync(item.fixture.root, { force: true, recursive: true })
      }
    }
  })

  test('stale-owner cleanup rejects a rogue recovery gate child before subject mutation', () => {
    const root = fixtureRoot()
    const temporary = `.nightshift-init-backlog.${'a'.repeat(64)}.1.tmp`
    try {
      ownerFixture(root, { temporaryPaths: [temporary] })
      writeFileSync(join(root, temporary), Buffer.from('temporary', 'utf8'), { mode: 0o600 })
      const inspected = inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
      const lockBytes = readFileSync(join(root, '.nightshift-init-backlog.lock'))
      const temporaryBytes = readFileSync(join(root, temporary))
      const applyRequest = { ...request(root, 'stale-owner', '.nightshift-init-backlog.lock'), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'cleanup' }
      assert.throws(() => applyRecovery(applyRequest, { killProcess: absentPid(), onTransition: (point) => { if (point === 'after-recovery-gate-owner-publish') writeFileSync(join(root, RECOVERY_GATE, 'rogue'), Buffer.from('rogue', 'utf8'), { mode: 0o600 }) } }), (error) => error.record?.code === 'snapshot-drift' && error.record.phase === 'prevalidate')
      assert.deepEqual(readFileSync(join(root, '.nightshift-init-backlog.lock')), lockBytes)
      assert.deepEqual(readFileSync(join(root, temporary)), temporaryBytes)
      assert.deepEqual(readFileSync(join(root, RECOVERY_GATE, 'rogue')), Buffer.from('rogue', 'utf8'))
      assert.ok(existsSync(join(root, RECOVERY_GATE, 'owner.json')))
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('empty recovery gate rejects stage-only residue appearing before apply', () => {
    const root = fixtureRoot()
    try {
      const gate = join(root, RECOVERY_GATE)
      mkdirSync(gate, { mode: 0o700 })
      const inspected = inspectRecovery(request(root, 'stale-recovery-gate', RECOVERY_GATE), { killProcess: absentPid() })
      const stageBytes = Buffer.from('successor stage', 'utf8')
      writeFileSync(join(gate, 'owner.new'), stageBytes, { mode: 0o600 })
      assert.throws(() => applyRecovery({ ...request(root, 'stale-recovery-gate', RECOVERY_GATE), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'cleanup' }, { killProcess: absentPid() }), (error) => error.record?.code === 'snapshot-drift' && error.record.phase === 'prevalidate')
      assert.deepEqual(readFileSync(join(gate, 'owner.new')), stageBytes)
      assert.equal(existsSync(join(gate, 'owner.json')), false)
      assert.deepEqual(require('node:fs').readdirSync(gate), ['owner.new'])
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('recovery gate mode is verified after mkdir before owner staging and owned residue is removed', () => {
    if (process.platform === 'win32') return
    const ownerRoot = fixtureRoot()
    try {
      ownerFixture(ownerRoot)
      chmodSync(ownerRoot, 0o2775)
      const inspected = inspectRecovery(request(ownerRoot, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
      assert.throws(() => applyRecovery({ ...request(ownerRoot, 'stale-owner', '.nightshift-init-backlog.lock'), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'cleanup' }, { killProcess: absentPid() }), /mode|gate|cleanup/i)
      assert.equal(existsSync(join(ownerRoot, RECOVERY_GATE)), false)
      assert.equal(existsSync(join(ownerRoot, RECOVERY_GATE, 'owner.new')), false)
    } finally {
      chmodSync(ownerRoot, 0o700)
      rmSync(ownerRoot, { force: true, recursive: true })
    }
  })

  test('recovery replacement uses a nested same-directory temporary and atomic rename', () => {
    const root = fixtureRoot()
    try {
      mkdirSync(join(root, '.claude'), { mode: 0o700 })
      const target = '.claude/FEATURES.md'
      const targetPath = join(root, ...target.split('/'))
      const currentBytes = Buffer.from('current\n', 'utf8')
      const replacementBytes = Buffer.from('replacement\n', 'utf8')
      writeFileSync(targetPath, currentBytes, { mode: 0o644 })
      const temporaryPaths = []
      const expected = stableOpenFile(root, targetPath, { requireSingleLink: true })
      publishRecoveryFile(root, targetPath, replacementBytes, process.platform === 'win32' ? null : 0o644, { expected, recoveryId: 'd'.repeat(64), onTemporaryStaged: (path) => temporaryPaths.push(path) })
      const expectedTemporary = join(root, '.claude', `.nightshift-init-backlog.${'d'.repeat(64)}.${sha256(Buffer.from(target, 'utf8'))}.tmp`)

      assert.deepEqual(temporaryPaths, [expectedTemporary])
      assert.equal(readFileSync(targetPath).toString('utf8'), 'replacement\n')
      assert.equal(existsSync(expectedTemporary), false)
      assert.equal(recoveryTemporaryTarget(target, 'd'.repeat(64)), `.claude/.nightshift-init-backlog.${'d'.repeat(64)}.${sha256(Buffer.from(target, 'utf8'))}.tmp`)
      assert.throws(() => publishRecoveryFile(root, targetPath, Buffer.from('another\n', 'utf8'), process.platform === 'win32' ? null : 0o644, { expected: stableOpenFile(root, targetPath, { requireSingleLink: true }), recoveryId: 'e'.repeat(64), temporary: join(root, `.nightshift-init-backlog.${'e'.repeat(64)}.${sha256(Buffer.from(target, 'utf8'))}.tmp`) }), /same-directory|target directory/i)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('recover-apply transient owners carry the recover-apply identity and derived temporary', () => {
    const cases = [
      () => {
        const fixture = backupFixture()
        const inspected = backupInspection(fixture)
        return { disposition: 'restore', expected: `.nightshift-init-backlog.${inspected.recoveryId}.${sha256(Buffer.from(fixture.target, 'utf8'))}.tmp`, expectedCount: 3, inspected, request: { ...request(fixture.root, 'abandoned-backup', fixture.backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'restore' }, root: fixture.root }
      },
      () => {
        const fixture = markerFixture()
        const inspected = inspectRecovery(request(fixture.root, 'election-marker', fixture.marker), { currentInspection: { git: { kind: 'git', freshScaffold: true } } })
        return { disposition: 'track', expected: `.nightshift-init-backlog.${inspected.recoveryId}.${sha256(Buffer.from(fixture.marker, 'utf8'))}.tmp`, expectedCount: 2, inspected, request: { ...request(fixture.root, 'election-marker', fixture.marker), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'track' }, root: fixture.root }
      },
    ]
    for (const makeCase of cases) {
      const item = makeCase()
      try {
        let lockRecord
        const result = applyRecovery(item.request, { onPublished: (path) => { if (path.endsWith('.nightshift-init-backlog.lock')) lockRecord = JSON.parse(readFileSync(path, 'utf8')) } })

        assert.equal(result.status, 'completed')
        assert.equal(lockRecord.operation, 'recover-apply')
        assert.equal(lockRecord.recoveryId, item.inspected.recoveryId)
        assert.ok(lockRecord.temporaryPaths.includes(item.expected))
        assert.equal(lockRecord.temporaryPaths.length, item.expectedCount)
      } finally { rmSync(item.root, { force: true, recursive: true }) }
    }
  })

  test('recover-apply owner recovery temporaries derive marker and backup hashes from same-directory inventory', () => {
    const markerRoot = fixtureRoot()
    const backupRoot = fixtureRoot()
    const invalidRoot = fixtureRoot()
    const wrongDirectoryRoot = fixtureRoot()
    const recoveryId = 'd'.repeat(64)
    const ownerNonce = 'c'.repeat(32)
    const markerHash = sha256(Buffer.from(ELECTION_MARKER_PATH, 'utf8'))
    const backupTargetHash = sha256(Buffer.from('FEATURES.md', 'utf8'))
    const backup = `.tmp/nightshift-init-backlog-unwrap-${'a'.repeat(64)}-${'b'.repeat(64)}-${backupTargetHash}.bak`
    const markerTemporary = `.nightshift-init-backlog.${recoveryId}.${markerHash}.tmp`
    const backupTemporary = `.tmp/.nightshift-init-backlog.${'b'.repeat(64)}.${backupTargetHash}.tmp`
    const wrongTemporary = `.nightshift-init-backlog.${recoveryId}.${'e'.repeat(64)}.tmp`
    const wrongDirectoryTemporary = `.tmp/.nightshift-init-backlog.${recoveryId}.${markerHash}.tmp`
    const stage = `.nightshift-init-backlog.lock.321.${ownerNonce}.new`
    const createOwner = (root, temporaryPaths, operation = 'recover-apply', manifestId = null) => {
      writeCanonical(join(root, '.nightshift-init-backlog.lock'), { createdAtUnixMs: 0, manifestId, operation, ownerNonce, pid: 321, protocolVersion: 1, recoveryId: operation === 'recover-apply' ? recoveryId : null, root, temporaryPaths: [...temporaryPaths].sort(compareOrdinal), unfinalizedDirectories: [] })
    }
    const inspectOwner = (root) => inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
    try {
      writeFileSync(join(markerRoot, markerTemporary), Buffer.from('marker', 'utf8'), { mode: 0o600 })
      createOwner(markerRoot, [markerTemporary])
      assert.equal(inspectOwner(markerRoot).evidence.owner.record.operation, 'recover-apply')

      mkdirSync(join(backupRoot, '.tmp'), { mode: 0o700 })
      writeFileSync(join(backupRoot, ...backup.split('/')), Buffer.from('backup', 'utf8'), { mode: 0o600 })
      writeFileSync(join(backupRoot, ...backupTemporary.split('/')), Buffer.from('temporary', 'utf8'), { mode: 0o600 })
      createOwner(backupRoot, [backup, backupTemporary], 'apply', 'b'.repeat(64))
      assert.equal(inspectOwner(backupRoot).evidence.owner.record.operation, 'apply')

      writeFileSync(join(invalidRoot, wrongTemporary), Buffer.from('wrong', 'utf8'), { mode: 0o600 })
      createOwner(invalidRoot, [wrongTemporary])
      assert.throws(() => inspectOwner(invalidRoot), /malformed|inventory|temporary/i)

      mkdirSync(join(wrongDirectoryRoot, '.tmp'), { mode: 0o700 })
      writeFileSync(join(wrongDirectoryRoot, wrongDirectoryTemporary), Buffer.from('temporary', 'utf8'), { mode: 0o600 })
      createOwner(wrongDirectoryRoot, [wrongDirectoryTemporary])
      assert.throws(() => inspectOwner(wrongDirectoryRoot), /malformed|inventory|temporary/i)
    } finally {
      rmSync(markerRoot, { force: true, recursive: true })
      rmSync(backupRoot, { force: true, recursive: true })
      rmSync(invalidRoot, { force: true, recursive: true })
      rmSync(wrongDirectoryRoot, { force: true, recursive: true })
    }
  })

  test('stale-owner evidence accepts exact backup stage and final tuple combinations', () => {
    const cases = [
      { stagePresent: false, snapshotId: 'a'.repeat(64), manifestId: 'b'.repeat(64), targetHash: sha256(Buffer.from('FEATURES.md', 'utf8')) },
      { stagePresent: true, snapshotId: 'c'.repeat(64), manifestId: 'd'.repeat(64), targetHash: sha256(Buffer.from('BUGS.md', 'utf8')) },
    ]
    for (const item of cases) {
      const root = fixtureRoot()
      try {
        const stage = `.tmp/.nightshift-init-backlog-unwrap-${item.snapshotId}-${item.manifestId}-${item.targetHash}.tmp`
        const backup = `.tmp/nightshift-init-backlog-unwrap-${item.snapshotId}-${item.manifestId}-${item.targetHash}.bak`
        mkdirSync(join(root, '.tmp'), { mode: 0o700 })
        if (item.stagePresent) {
          writeFileSync(join(root, ...stage.split('/')), Buffer.from('backup', 'utf8'), { mode: 0o600 })
          linkSync(join(root, ...stage.split('/')), join(root, ...backup.split('/')))
        } else {
          writeFileSync(join(root, ...backup.split('/')), Buffer.from('backup', 'utf8'), { mode: 0o600 })
        }
        ownerFixture(root, { manifestId: item.manifestId, temporaryPaths: [stage, backup] })

        const inspected = inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })

        assert.deepEqual(inspected.evidence.owner.temporaryStates.map((state) => state.present), [item.stagePresent, true])
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    }
  })

  test('stale-owner evidence rejects a backup stage without the required dot prefix', () => {
    const root = fixtureRoot()
    try {
      const snapshotId = 'a'.repeat(64)
      const manifestId = 'b'.repeat(64)
      const targetHash = sha256(Buffer.from('FEATURES.md', 'utf8'))
      const malformedStage = `.tmp/Xnightshift-init-backlog-unwrap-${snapshotId}-${manifestId}-${targetHash}.tmp`
      const backup = `.tmp/nightshift-init-backlog-unwrap-${snapshotId}-${manifestId}-${targetHash}.bak`
      mkdirSync(join(root, '.tmp'), { mode: 0o700 })
      writeFileSync(join(root, ...malformedStage.split('/')), Buffer.from('backup', 'utf8'), { mode: 0o600 })
      linkSync(join(root, ...malformedStage.split('/')), join(root, ...backup.split('/')))
      ownerFixture(root, { manifestId, temporaryPaths: [malformedStage, backup] })

      assert.throws(() => inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() }), /malformed|inventory|temporary/i)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('stale-owner evidence rejects a missing stage paired with a different backup snapshot', () => {
    const root = fixtureRoot()
    try {
      const manifestId = 'e'.repeat(64)
      const targetHash = sha256(Buffer.from('FEATURES.md', 'utf8'))
      const stage = `.tmp/.nightshift-init-backlog-unwrap-${'a'.repeat(64)}-${manifestId}-${targetHash}.tmp`
      const backup = `.tmp/nightshift-init-backlog-unwrap-${'b'.repeat(64)}-${manifestId}-${targetHash}.bak`
      mkdirSync(join(root, '.tmp'), { mode: 0o700 })
      writeFileSync(join(root, ...backup.split('/')), Buffer.from('backup', 'utf8'), { mode: 0o600 })
      ownerFixture(root, { manifestId, temporaryPaths: [stage, backup] })

      assert.throws(() => inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() }), /contiguous|inventory|pair/i)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('stale-owner evidence rejects a missing stage paired with a different backup target hash', () => {
    const root = fixtureRoot()
    try {
      const manifestId = 'f'.repeat(64)
      const stage = `.tmp/.nightshift-init-backlog-unwrap-${'a'.repeat(64)}-${manifestId}-${sha256(Buffer.from('FEATURES.md', 'utf8'))}.tmp`
      const backup = `.tmp/nightshift-init-backlog-unwrap-${'a'.repeat(64)}-${manifestId}-${sha256(Buffer.from('BUGS.md', 'utf8'))}.bak`
      mkdirSync(join(root, '.tmp'), { mode: 0o700 })
      writeFileSync(join(root, ...backup.split('/')), Buffer.from('backup', 'utf8'), { mode: 0o600 })
      ownerFixture(root, { manifestId, temporaryPaths: [stage, backup] })

      assert.throws(() => inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() }), /contiguous|inventory|pair/i)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('stale-owner evidence permits an absent backup stage before its present final backup', () => {
    const root = fixtureRoot()
    try {
      const snapshotId = 'c'.repeat(64)
      const manifestId = 'd'.repeat(64)
      const targetHash = sha256(Buffer.from('FEATURES.md', 'utf8'))
      const stage = `.tmp/.nightshift-init-backlog-unwrap-${snapshotId}-${manifestId}-${targetHash}.tmp`
      const backup = `.tmp/nightshift-init-backlog-unwrap-${snapshotId}-${manifestId}-${targetHash}.bak`
      mkdirSync(join(root, '.tmp'), { mode: 0o700 })
      writeFileSync(join(root, ...backup.split('/')), Buffer.from('original\n', 'utf8'), { mode: 0o600 })
      ownerFixture(root, { manifestId, temporaryPaths: [stage, backup] })
      const inspected = inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })

      assert.deepEqual(inspected.evidence.owner.temporaryStates.map((item) => item.target), [stage, backup])
      assert.equal(inspected.evidence.owner.temporaryStates[0].present, false)
      assert.equal(inspected.evidence.owner.temporaryStates[1].present, true)
    } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('recovery cleanup failures use the cleanup carrier for every recovery subject', () => {
    const assertCleanupFailure = (action, retainedBackups) => {
      assert.throws(action, (error) => error.record?.code === 'cleanup-failed' && error.record.phase === 'cleanup' && error.record.recovery?.status === 'cleanup-failed' && canonicalJson(error.record.recovery.retainedBackups) === canonicalJson(retainedBackups) && error.record.recovery.warnings.some((warning) => warning.code === 'manual-cleanup'))
    }
    const failingRemove = () => { throw new Error('cleanup failure') }

    const staleOwnerRoot = fixtureRoot()
    try {
      const temp = `.nightshift-init-backlog.${'a'.repeat(64)}.1.tmp`
      writeFileSync(join(staleOwnerRoot, temp), Buffer.from('temp', 'utf8'), { mode: 0o600 })
      ownerFixture(staleOwnerRoot, { temporaryPaths: [temp] })
      const inspected = inspectRecovery(request(staleOwnerRoot, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
      assertCleanupFailure(() => applyRecovery({ ...request(staleOwnerRoot, 'stale-owner', '.nightshift-init-backlog.lock'), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'cleanup' }, { killProcess: absentPid(), removeAndVerify: failingRemove }), [])
    } finally { rmSync(staleOwnerRoot, { force: true, recursive: true }) }

    const gateRoot = fixtureRoot()
    try {
      const gate = join(gateRoot, RECOVERY_GATE)
      mkdirSync(gate, { mode: 0o700 })
      writeFileSync(join(gate, 'owner.new'), Buffer.from('partial\n', 'utf8'), { mode: 0o600 })
      const inspected = inspectRecovery(request(gateRoot, 'stale-recovery-gate', RECOVERY_GATE), { killProcess: absentPid() })
      assertCleanupFailure(() => applyRecovery({ ...request(gateRoot, 'stale-recovery-gate', RECOVERY_GATE), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'cleanup' }, { killProcess: absentPid(), removeAndVerify: failingRemove }), [])
    } finally { rmSync(gateRoot, { force: true, recursive: true }) }

    const stageRoot = fixtureRoot()
    try {
      const target = stageFixture(stageRoot)
      const inspected = inspectRecovery(request(stageRoot, 'orphan-lock-stage', target), { killProcess: absentPid() })
      assertCleanupFailure(() => applyRecovery({ ...request(stageRoot, 'orphan-lock-stage', target), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'remove' }, { killProcess: absentPid(), removeAndVerify: failingRemove }), [])
    } finally { rmSync(stageRoot, { force: true, recursive: true }) }

    const markerRoot = fixtureRoot()
    try {
      const marker = ELECTION_MARKER_PATH
      writeCanonical(join(markerRoot, marker), { invalid: true })
      const inspected = inspectRecovery(request(markerRoot, 'election-marker', marker), { currentInspection: { git: { kind: 'git', freshScaffold: true } } })
      assertCleanupFailure(() => applyRecovery({ ...request(markerRoot, 'election-marker', marker), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'abandon' }, { unlinkSync: failingRemove }), [])
    } finally { rmSync(markerRoot, { force: true, recursive: true }) }
  })

  test('recover-apply validates injected recovery owner identity before creating a gate', () => {
    for (const options of [{ pid: 0 }, { ownerNonce: 'invalid' }]) {
      const root = fixtureRoot()
      try {
        ownerFixture(root)
        const inspected = inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
        const applyRequest = { ...request(root, 'stale-owner', '.nightshift-init-backlog.lock'), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'cleanup' }

        assert.throws(() => applyRecovery(applyRequest, { killProcess: absentPid(), ...options }), (error) => error.record?.code === 'runtime-lock' && error.record.phase === 'lock')
        assert.equal(existsSync(join(root, RECOVERY_GATE)), false)
      } finally { rmSync(root, { force: true, recursive: true }) }
    }
  })

  test('recover-apply rejects an oversized result bound before creating recovery state', () => {
    const root = fixtureRoot()
    try {
      ownerFixture(root)
      const inspected = inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
      const targets = Array.from({ length: 300 }, (_, index) => `${String(index).padStart(3, '0')}${'x'.repeat(3980)}`)
      const owner = { ...inspected.evidence.owner, record: { ...inspected.evidence.owner.record, temporaryPaths: targets }, temporaryStates: targets.map((target) => ({ mode: null, present: false, rawSha256: null, target })) }
      const inflated = { ...inspected, evidence: { ...inspected.evidence, owner } }
      inflated.recoveryId = deriveRecoveryId({ ...inflated, recoveryId: null })
      writeCanonical(join(root, '.nightshift-init-backlog.lock'), owner.record)
      const applyRequest = { ...request(root, 'stale-owner', '.nightshift-init-backlog.lock'), operation: 'recover-apply', recoveryInspection: inflated, disposition: 'cleanup' }

      assert.throws(() => applyRecovery(applyRequest, { killProcess: absentPid() }), (error) => error.record?.code === 'payload-too-large' && error.record.phase === 'prevalidate')
      assert.equal(existsSync(join(root, RECOVERY_GATE)), false)
      assert.equal(existsSync(join(root, '.nightshift-init-backlog.lock')), true)
    } finally { rmSync(root, { force: true, recursive: true }) }
  })

  test('dispatcher classifies canonical invalid non-Git markers and blocks valid same-root Git markers', () => {
    const invalidRoot = fixtureRoot()
    const validRoot = fixtureRoot()
    try {
      const invalidMarker = { protocolVersion: 1, root: invalidRoot, snapshotId: 'a'.repeat(64), state: 'unknown' }
      writeCanonical(join(invalidRoot, ELECTION_MARKER_PATH), invalidMarker)
      const invalidRequest = request(invalidRoot, 'election-marker', ELECTION_MARKER_PATH)
      const invalidDispatch = runPrivateDispatcher(Buffer.from(`${canonicalJson(invalidRequest)}\n`, 'utf8'), {
        'recover-inspect': (value) => inspectRecovery(value, { currentInspection: { git: { kind: 'non-git', freshScaffold: false } } }),
      })

      assert.equal(invalidDispatch.exitCode, 0)
      const invalidResult = JSON.parse(invalidDispatch.stdout.toString('utf8'))
      assert.equal(invalidResult.evidence.marker.classification, 'invalid')
      assert.equal(invalidResult.evidence.marker.gitKind, 'non-git')
      assert.deepEqual(invalidResult.allowedDispositions, ['abandon'])

      const validMarker = { protocolVersion: 1, root: validRoot, snapshotId: 'b'.repeat(64), state: 'deferred' }
      writeCanonical(join(validRoot, ELECTION_MARKER_PATH), validMarker)
      const validRequest = request(validRoot, 'election-marker', ELECTION_MARKER_PATH)
      const validDispatch = runPrivateDispatcher(Buffer.from(`${canonicalJson(validRequest)}\n`, 'utf8'), {
        'recover-inspect': (value) => inspectRecovery(value, { currentInspection: { git: { kind: 'git', freshScaffold: false } } }),
      })

      assert.equal(validDispatch.exitCode, 1)
      assert.equal(JSON.parse(validDispatch.stdout.toString('utf8')).code, 'runtime-marker')
    } finally {
      rmSync(invalidRoot, { force: true, recursive: true })
      rmSync(validRoot, { force: true, recursive: true })
    }
  })

  test('stale owner and orphan stage accept every operation-specific lock record shape', () => {
    const cases = [
      { operation: 'inspect', manifestId: null, recoveryId: null },
      { operation: 'apply', manifestId: 'a'.repeat(64), recoveryId: null },
      { operation: 'recover-inspect', manifestId: null, recoveryId: null },
      { operation: 'recover-apply', manifestId: null, recoveryId: 'b'.repeat(64) },
    ]
    for (const item of cases) {
      const ownerRoot = fixtureRoot()
      const stageRoot = fixtureRoot()
      const pid = 321
      const ownerNonce = 'c'.repeat(32)
      const stage = `.nightshift-init-backlog.lock.${pid}.${ownerNonce}.new`
      const recoveryHash = item.operation === 'recover-apply' ? sha256(Buffer.from(ELECTION_MARKER_PATH, 'utf8')) : 'd'.repeat(64)
      const recoveryTemporary = `.nightshift-init-backlog.${item.recoveryId}.${recoveryHash}.tmp`
      const temporaryPaths = item.operation === 'recover-apply' ? [recoveryTemporary, stage].sort(compareOrdinal) : [stage]
      const record = { createdAtUnixMs: 0, manifestId: item.manifestId, operation: item.operation, ownerNonce, pid, protocolVersion: 1, recoveryId: item.recoveryId, root: ownerRoot, temporaryPaths, unfinalizedDirectories: [] }
      const stageRecord = { ...record, root: stageRoot }
      try {
        writeCanonical(join(ownerRoot, '.nightshift-init-backlog.lock'), record)
        const ownerInspection = inspectRecovery(request(ownerRoot, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
        assert.equal(ownerInspection.evidence.owner.record.operation, item.operation)
        assert.equal(ownerInspection.evidence.owner.pidStatus, 'absent')

        writeCanonical(join(stageRoot, stage), stageRecord)
        const stageInspection = inspectRecovery(request(stageRoot, 'orphan-lock-stage', stage), { killProcess: absentPid() })
        assert.equal(stageInspection.evidence.lockStage.record.operation, item.operation)
        assert.deepEqual(stageInspection.allowedDispositions, ['remove'])
      } finally {
        rmSync(ownerRoot, { force: true, recursive: true })
        rmSync(stageRoot, { force: true, recursive: true })
      }
    }
  })

  test('stale-owner retry treats a retained final backup as inactive after an empty gate prefix', () => {
    const root = fixtureRoot()
    const target = 'FEATURES.md'
    const manifestId = 'a'.repeat(64)
    const snapshotId = 'b'.repeat(64)
    const backupTarget = `.tmp/nightshift-init-backlog-unwrap-${snapshotId}-${manifestId}-${sha256(Buffer.from(target, 'utf8'))}.bak`
    const owner = { createdAtUnixMs: 0, manifestId, operation: 'apply', ownerNonce: 'c'.repeat(32), pid: 321, protocolVersion: 1, recoveryId: null, root, temporaryPaths: [backupTarget], unfinalizedDirectories: [] }
    try {
      mkdirSync(join(root, '.tmp'), { mode: 0o700 })
      writeFileSync(join(root, ...backupTarget.split('/')), Buffer.from('backup\n', 'utf8'), { mode: 0o600 })
      writeCanonical(join(root, '.nightshift-init-backlog.lock'), owner)
      const inspected = inspectRecovery(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
      unlinkSync(join(root, '.nightshift-init-backlog.lock'))
      mkdirSync(join(root, RECOVERY_GATE), { mode: 0o700 })

      const applied = applyRecovery(recoveryApplyEnvelope(request(root, 'stale-owner', '.nightshift-init-backlog.lock'), inspected, 'cleanup'), { killProcess: absentPid() })

      assert.equal(applied.status, 'already-complete')
      assert.deepEqual(applied.retainedPaths, [backupTarget])
      assert.equal(existsSync(join(root, RECOVERY_GATE)), false)
      assert.equal(existsSync(join(root, ...backupTarget.split('/'))), true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('raw dispatcher serializes valid stale-owner and orphan-stage evidence for every lock operation', () => {
    const cases = [
      { operation: 'inspect', manifestId: null, recoveryId: null },
      { operation: 'apply', manifestId: 'a'.repeat(64), recoveryId: null },
      { operation: 'recover-inspect', manifestId: null, recoveryId: null },
      { operation: 'recover-apply', manifestId: null, recoveryId: 'b'.repeat(64) },
    ]
    for (const item of cases) {
      const ownerRoot = fixtureRoot()
      const stageRoot = fixtureRoot()
      const pid = 321
      const ownerNonce = 'c'.repeat(32)
      const stage = `.nightshift-init-backlog.lock.${pid}.${ownerNonce}.new`
      const recoveryHash = item.operation === 'recover-apply' ? sha256(Buffer.from(ELECTION_MARKER_PATH, 'utf8')) : 'd'.repeat(64)
      const recoveryTemporary = `.nightshift-init-backlog.${item.recoveryId}.${recoveryHash}.tmp`
      const temporaryPaths = item.operation === 'recover-apply' ? [recoveryTemporary, stage].sort(compareOrdinal) : [stage]
      const record = { createdAtUnixMs: 0, manifestId: item.manifestId, operation: item.operation, ownerNonce, pid, protocolVersion: 1, recoveryId: item.recoveryId, root: ownerRoot, temporaryPaths, unfinalizedDirectories: [] }
      const stageRecord = { ...record, root: stageRoot }
      try {
        writeCanonical(join(ownerRoot, '.nightshift-init-backlog.lock'), record)
        const ownerRequest = request(ownerRoot, 'stale-owner', '.nightshift-init-backlog.lock')
        const ownerDispatch = runPrivateDispatcher(Buffer.from(`${canonicalJson(ownerRequest)}\n`, 'utf8'), { 'recover-inspect': (value) => inspectRecovery(value, { killProcess: absentPid() }) })
        assert.equal(ownerDispatch.exitCode, 0, ownerDispatch.stderr.toString('utf8'))
        assert.equal(JSON.parse(ownerDispatch.stdout.toString('utf8')).evidence.owner.record.operation, item.operation)

        writeCanonical(join(stageRoot, stage), stageRecord)
        const stageRequest = request(stageRoot, 'orphan-lock-stage', stage)
        const stageDispatch = runPrivateDispatcher(Buffer.from(`${canonicalJson(stageRequest)}\n`, 'utf8'), { 'recover-inspect': (value) => inspectRecovery(value, { killProcess: absentPid() }) })
        assert.equal(stageDispatch.exitCode, 0, stageDispatch.stderr.toString('utf8'))
        assert.equal(JSON.parse(stageDispatch.stdout.toString('utf8')).evidence.lockStage.record.operation, item.operation)
      } finally {
        rmSync(ownerRoot, { force: true, recursive: true })
        rmSync(stageRoot, { force: true, recursive: true })
      }
    }
  })

  test('stale-owner recovery accepts bootstrap lock and stage hard links from an owner-publication crash', () => {
    const fixture = unwrapFixture(1)
    try {
      assert.throws(() => publishApply(fixture.applyRequest, { currentInspection: fixture.carried, crash: true, crashAfterOwnerPublish: true, onPublished: () => { throw new Error('owner publication crash') } }), /owner publication crash/)
      const lock = JSON.parse(readFileSync(join(fixture.root, '.nightshift-init-backlog.lock'), 'utf8'))
      const stage = lock.temporaryPaths.find((target) => target.endsWith('.new'))
      assert.equal(statSync(join(fixture.root, '.nightshift-init-backlog.lock')).nlink, 2)
      assert.equal(statSync(join(fixture.root, stage)).nlink, 2)

      const inspected = inspectRecovery(request(fixture.root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
      const applied = applyRecovery(recoveryApplyEnvelope(request(fixture.root, 'stale-owner', '.nightshift-init-backlog.lock'), inspected, 'cleanup'), { killProcess: absentPid() })

      assert.equal(applied.status, 'completed')
      assert.equal(existsSync(join(fixture.root, '.nightshift-init-backlog.lock')), false)
      assert.equal(existsSync(join(fixture.root, stage)), false)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('stale-owner recovery accepts backup stage and final hard links from a publication crash', () => {
    const fixture = unwrapFixture(1)
    try {
      assert.throws(() => publishApply(fixture.applyRequest, { currentInspection: fixture.carried, collectInspection: () => fixture.post, crash: true, ownerNonce: 'a'.repeat(32), onPublished: (destination) => { if (destination.endsWith('.bak')) throw new Error('backup publication crash') } }), /backup publication crash/)
      const lock = JSON.parse(readFileSync(join(fixture.root, '.nightshift-init-backlog.lock'), 'utf8'))
      const backup = lock.temporaryPaths.find((target) => target.endsWith('.bak'))
      const stage = lock.temporaryPaths.find((target) => target.endsWith('.tmp') && target.includes('.nightshift-init-backlog-unwrap-'))
      assert.equal(statSync(join(fixture.root, ...backup.split('/'))).nlink, 2)
      assert.equal(statSync(join(fixture.root, ...stage.split('/'))).nlink, 2)

      const inspected = inspectRecovery(request(fixture.root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
      const applied = applyRecovery(recoveryApplyEnvelope(request(fixture.root, 'stale-owner', '.nightshift-init-backlog.lock'), inspected, 'cleanup'), { killProcess: absentPid() })

      assert.equal(applied.status, 'completed')
      assert.equal(existsSync(join(fixture.root, '.nightshift-init-backlog.lock')), false)
      assert.equal(existsSync(join(fixture.root, ...stage.split('/'))), false)
      assert.equal(existsSync(join(fixture.root, ...backup.split('/'))), true)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('stale-owner recovery accepts marker witness and final hard links from a publication crash', () => {
    const fixture = unwrapFixture(1)
    const carried = { ...fixture.carried, git: { ...fixture.carried.git, electionRequired: true, kind: 'git', objectFormat: 'sha1', plansPolicy: 'satisfied' } }
    carried.snapshotId = deriveSnapshotId({ ...carried, snapshotId: null })
    const applyRequest = { ...fixture.applyRequest, inspection: carried, versionControlChoice: 'track' }
    try {
      assert.throws(() => publishApply(applyRequest, { currentInspection: carried, crash: true, ownerNonce: 'b'.repeat(32), failAt: 'after-marker-alias-removal' }), /Injected publication failure at after-marker-alias-removal/)
      const lock = JSON.parse(readFileSync(join(fixture.root, '.nightshift-init-backlog.lock'), 'utf8'))
      const witness = lock.temporaryPaths.find((target) => target.endsWith('.new.tmp'))
      assert.equal(statSync(join(fixture.root, ELECTION_MARKER_PATH)).nlink, 2)
      assert.equal(statSync(join(fixture.root, witness)).nlink, 2)

      const inspected = inspectRecovery(request(fixture.root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() })
      const applied = applyRecovery(recoveryApplyEnvelope(request(fixture.root, 'stale-owner', '.nightshift-init-backlog.lock'), inspected, 'cleanup'), { killProcess: absentPid() })

      assert.equal(applied.status, 'completed')
      assert.equal(existsSync(join(fixture.root, '.nightshift-init-backlog.lock')), false)
      assert.equal(existsSync(join(fixture.root, witness)), false)
      assert.equal(existsSync(join(fixture.root, ELECTION_MARKER_PATH)), true)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('stale-owner recovery rejects external links and same-byte topology drift', () => {
    for (const drift of ['external-link', 'replacement']) {
      const fixture = unwrapFixture(1)
      try {
        assert.throws(() => publishApply(fixture.applyRequest, { currentInspection: fixture.carried, collectInspection: () => fixture.post, crash: true, ownerNonce: 'c'.repeat(32), onPublished: (destination) => { if (destination.endsWith('.bak')) throw new Error('backup publication crash') } }), /backup publication crash/)
        const lock = JSON.parse(readFileSync(join(fixture.root, '.nightshift-init-backlog.lock'), 'utf8'))
        const backup = lock.temporaryPaths.find((target) => target.endsWith('.bak'))
        const stage = lock.temporaryPaths.find((target) => target.endsWith('.tmp') && target.includes('.nightshift-init-backlog-unwrap-'))
        const stagePath = join(fixture.root, ...stage.split('/'))
        const backupPath = join(fixture.root, ...backup.split('/'))
        if (drift === 'external-link') {
          linkSync(backupPath, join(fixture.root, 'external-backup-link'))
        } else {
          unlinkSync(stagePath)
          writeFileSync(stagePath, readFileSync(backupPath), { mode: 0o600 })
        }

        assert.throws(() => inspectRecovery(request(fixture.root, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() }), /malformed|hard-link|topology|identity|inspection failed/i, drift)
      } finally {
        rmSync(fixture.root, { force: true, recursive: true })
      }
    }
  })

  test('stale owner and orphan stage reject operation-specific identity fields', () => {
    const invalidRecords = [
      { operation: 'inspect', manifestId: 'a'.repeat(64), recoveryId: null },
      { operation: 'recover-inspect', manifestId: null, recoveryId: 'b'.repeat(64) },
      { operation: 'recover-apply', manifestId: 'c'.repeat(64), recoveryId: 'd'.repeat(64) },
      { operation: 'recover-apply', manifestId: null, recoveryId: null },
      { operation: 'apply', manifestId: null, recoveryId: 'e'.repeat(64) },
    ]
    for (const item of invalidRecords) {
      const ownerRoot = fixtureRoot()
      const pid = 321
      const ownerNonce = 'f'.repeat(32)
      const stage = `.nightshift-init-backlog.lock.${pid}.${ownerNonce}.new`
      const record = { createdAtUnixMs: 0, manifestId: item.manifestId, operation: item.operation, ownerNonce, pid, protocolVersion: 1, recoveryId: item.recoveryId, root: ownerRoot, temporaryPaths: [stage], unfinalizedDirectories: [] }
      try {
        writeCanonical(join(ownerRoot, '.nightshift-init-backlog.lock'), record)
        assert.throws(() => inspectRecovery(request(ownerRoot, 'stale-owner', '.nightshift-init-backlog.lock'), { killProcess: absentPid() }), (error) => error.record?.code === 'runtime-lock')

      } finally {
        rmSync(ownerRoot, { force: true, recursive: true })
      }
    }
  })

  test('transient subject callback failure plus lock cleanup failure returns cleanup evidence', () => {
    const fixture = backupFixture()
    const callbackError = new Error('subject callback detail must not be exposed')
    const cleanupError = Object.assign(new Error('cleanup detail must not replace the carrier'), { code: 'EACCES' })
    try {
      const requestValue = request(fixture.root, 'abandoned-backup', fixture.backupTarget)
      assert.throws(
        () => inspectRecovery(requestValue, {
          collectInspection: () => { throw callbackError },
          removeAndVerify: () => { throw cleanupError },
        }),
        (error) => {
          assert.equal(error.record?.code, 'cleanup-failed')
          assert.equal(error.record?.phase, 'cleanup')
          assert.equal(error.record?.recovery?.status, 'cleanup-failed')
          assert.equal(error.record?.systemCode, 'EACCES')
          assert.deepEqual(error.record?.recovery?.retainedBackups, [])
          assert.deepEqual(error.record?.recovery?.warnings, [{ code: 'manual-cleanup', detail: 'Manual cleanup is required for retained recovery residue.', target: '.nightshift-init-backlog.lock' }])
          assert.equal(error.record?.detail.includes(callbackError.message), false)
          assert.equal(error.record?.detail.includes(cleanupError.message), false)
          assert.equal(existsSync(join(fixture.root, '.nightshift-init-backlog.lock')), true)

          return true
        },
      )
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })
  test('successful abandoned-backup restore with lock cleanup failure returns typed cleanup evidence', () => {
    const makeFailure = Object.assign(new Error('lock cleanup failure'), { code: 'EACCES' })
    const makeRemove = () => (path) => {
      if (path.endsWith('.nightshift-init-backlog.lock')) throw makeFailure

      unlinkSync(path)
    }
    const directFixture = backupFixture()
    try {
      const inspected = backupInspection(directFixture)
      const applyRequest = { ...request(directFixture.root, 'abandoned-backup', directFixture.backupTarget), operation: 'recover-apply', recoveryInspection: inspected, disposition: 'restore' }
      assert.throws(() => applyRecovery(applyRequest, { removeAndVerify: makeRemove() }), (error) => {
        assert.equal(error.record?.code, 'cleanup-failed')
        assert.equal(error.record?.phase, 'cleanup')
        assert.equal(error.record?.target, '.nightshift-init-backlog.lock')
        assert.deepEqual(error.record?.recovery, { retainedBackups: [], status: 'cleanup-failed', warnings: [{ code: 'manual-cleanup', detail: 'Manual cleanup is required for retained recovery residue.', target: '.nightshift-init-backlog.lock' }] })

        return true
      })
      assert.deepEqual(readFileSync(join(directFixture.root, directFixture.target)), Buffer.from('backup\n', 'utf8'))
      assert.equal(existsSync(join(directFixture.root, ...directFixture.backupTarget.split('/'))), false)
    } finally {
      rmSync(directFixture.root, { force: true, recursive: true })
    }

    const dispatchedFixture = backupFixture()
    try {
      const inspected = backupInspection(dispatchedFixture)
      const raw = { disposition: 'restore', host: 'claude-code', hostContext: hostContext(), operation: 'recover-apply', protocolVersion: 1, recoveryInspection: inspected, root: dispatchedFixture.root }
      const dispatched = runPrivateDispatcher(Buffer.from(`${canonicalJson(raw)}\n`, 'utf8'), { 'recover-apply': (value) => applyRecovery(value, { removeAndVerify: makeRemove() }) })
      assert.equal(dispatched.exitCode, 1)
      const record = JSON.parse(dispatched.stdout.toString('utf8'))
      assert.equal(record.code, 'cleanup-failed')
      assert.equal(record.phase, 'cleanup')
      assert.equal(record.target, '.nightshift-init-backlog.lock')
      assert.deepEqual(record.recovery, { retainedBackups: [], status: 'cleanup-failed', warnings: [{ code: 'manual-cleanup', detail: 'Manual cleanup is required for retained recovery residue.', target: '.nightshift-init-backlog.lock' }] })
      assert.deepEqual(readFileSync(join(dispatchedFixture.root, dispatchedFixture.target)), Buffer.from('backup\n', 'utf8'))
      assert.equal(existsSync(join(dispatchedFixture.root, ...dispatchedFixture.backupTarget.split('/'))), false)
    } finally {
      rmSync(dispatchedFixture.root, { force: true, recursive: true })
    }
  })
}

module.exports = { runRecoveryCases }
