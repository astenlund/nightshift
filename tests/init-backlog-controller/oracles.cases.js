'use strict'

const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { dirname, join } = require('node:path')
const test = require('node:test')

const { failureRecord } = require('../../skills/init-backlog/lib/errors')
const { OPERATION, validateResultRecord: validateProtocolResultRecord } = require('../../skills/init-backlog/lib/protocol')
const { inspect } = require('../../skills/init-backlog/init-backlog')
const { canonicalJson, compareOrdinal, sha256 } = require('./helpers')
const { BREAKOUT_DIGEST_NOTICE, CLAUDE_ROOT_EXCLUSION_CONFIRMATION, CODEX_HOST_CONTEXT_CONFIRMATION, ELECTION_MARKER_PATH, HEX64_PATTERN, HOST_CONTROL_RECORDS, LIST_SEPARATOR, MAX_PRESENTATION_CANONICAL_BYTES, buildDecodedContentDisclosures, disclosureTurnByteLength, requireExactKeys, selectTerminalExpectation, validateLiveElectionMarker, validateTurnObject, windowsRepositoryImage } = require('./election-oracles')
const { HOST_FIXTURE_DIRECTORY, SCENARIO_IDS, INITIAL_PROMPT, APPROVAL_RESPONSES, ENTRYPOINTS, ENVELOPE_INSTRUCTIONS, HOST_CONTEXTS, QUICK_WINS_CONCEPTS, FEATURES_CONCEPTS, WHITESPACE_CODE_POINTS, isCanonicalBase64, isOrdinalSortedUnique, readCanonicalFixture, validateRepositoryObject, validateScenarioObject, listTree, loadHostFixtureTree, importSentinel, buildExpectedImportCases, buildEvaluationEnvelope } = require('./host-fixture-oracles')
const { buildExpectedScenarios, loadTemplateCompositions, materializeWindowsLivePlatformEol } = require('./host-fixture-recipes')

// Independent oracle pins: the driver's BYTE_BOUNDS host framing values are spelled out here on purpose and are deliberately not imported from the constants they verify.
const MAX_HOST_EVENT_FRAME_BYTES = 262144
const MAX_HOST_LINE_BYTES = 4194304

const IMPORT_FIXTURE_DIRECTORY = 'tests/fixtures/init-backlog-import'
const EVAL_FIXTURE_DIRECTORY = 'tests/fixtures/init-backlog-eval'
const TURN_SCHEMA_PATH = `${EVAL_FIXTURE_DIRECTORY}/turn.schema.json`
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const COMMITTED_FIXTURE_LEAVES = [
  TURN_SCHEMA_PATH,
  `${EVAL_FIXTURE_DIRECTORY}/controller-proxy.js`,
  `${HOST_FIXTURE_DIRECTORY}/manifest.json`,
  ...SCENARIO_IDS.map((scenarioId) => `${HOST_FIXTURE_DIRECTORY}/scenarios/${scenarioId}.json`),
  `${IMPORT_FIXTURE_DIRECTORY}/cases.json`,
  `${IMPORT_FIXTURE_DIRECTORY}/compatibility.json`,
]

const CLOSED_FUTURE_FIXTURE_LEAVES = [...COMMITTED_FIXTURE_LEAVES]

const GUIDANCE_SCENARIO_IDS = [
  'existing-legacy-history-approved',
  'fresh-empty-track-approved',
  'fresh-host-config-track-approved',
  'fresh-plans-only-election-deferred-approved',
  'fresh-structural-ignore-approved',
]

function validateCompatibilityRecord(object, casesSha256) {
  requireExactKeys(object, ['casesSha256', 'claudeVersion', 'probedOn', 'schemaVersion'], 'compatibility record')
  if (object.schemaVersion !== 1 || object.casesSha256 !== casesSha256) {
    throw new Error('compatibility record identity fields are invalid')
  }
  if (object.claudeVersion !== null || object.probedOn !== null) {
    if (typeof object.claudeVersion !== 'string' || object.claudeVersion.trim() === '' || typeof object.probedOn !== 'string' || !DATE_PATTERN.test(object.probedOn)) {
      throw new Error('compatibility record probe fields must both transition together from null to their probed values')
    }
  }
}

function classifyClaudeInspectAuthorization({ loadedMemoryPaths, rootPath, rootPresent, scriptedResponse }) {
  if (rootPresent) {
    if (!Array.isArray(loadedMemoryPaths)) {
      return { authorization: 'none', reasonCode: 'guidance-resolution' }
    }

    return loadedMemoryPaths.includes(rootPath)
      ? { authorization: 'inspect', hostContext: HOST_CONTEXTS.claudePresentRoot }
      : { authorization: 'none', reasonCode: 'guidance-resolution' }
  }
  if (scriptedResponse === CLAUDE_ROOT_EXCLUSION_CONFIRMATION) {
    return { authorization: 'inspect', gateId: 'claude-root-exclusion-confirmation', hostContext: HOST_CONTEXTS.claudeMissingRoot }
  }

  return { authorization: 'none', reasonCode: 'guidance-resolution' }
}

function reconstructDecodedContent(items) {
  assert.ok(items.length > 0, 'reconstruction requires at least one disclosure item')
  if (items.length === 1 && items[0].kind === 'decoded-empty') {
    return Buffer.alloc(0)
  }
  let expectedStart = 0
  const parts = []
  for (const [index, item] of items.entries()) {
    assert.equal(item.kind, 'decoded-content')
    assert.equal(item.chunkIndex, index, 'decoded-content chunks must be re-indexed in order')
    assert.equal(item.chunkCount, items.length)
    assert.equal(item.startByte, expectedStart, 'decoded-content chunks must be contiguous without overlap or gap')
    const chunkBytes = Buffer.from(item.text, 'utf8')
    assert.equal(item.endByte, item.startByte + chunkBytes.length)
    expectedStart = item.endByte
    parts.push(chunkBytes)
  }
  const image = Buffer.concat(parts)
  for (const item of items) {
    assert.equal(item.rawSha256, sha256(image), 'every chunk must carry the full raw image digest')
  }

  return image
}

function proposalDigest(manifestProposal) {
  return sha256(Buffer.from(canonicalJson(manifestProposal), 'utf8'))
}

function deterministicDigest({ finalTargets, manifest, proposals }) {
  return sha256(Buffer.from(canonicalJson({ finalTargets, manifest, proposals }), 'utf8'))
}

function validateDeterministicDigestParts({ applyOk, approvalBranch, finalTargets, manifest, proposals }) {
  if (!Array.isArray(proposals)) {
    throw new Error('deterministic digest proposals must be the inspected proposal array')
  }
  if (approvalBranch === 'approved') {
    if (manifest === null) {
      throw new Error('an approved branch must carry the apply-request manifest projection')
    }
    requireExactKeys(manifest, ['actions', 'proposalDispositions', 'semanticDecisions', 'versionControlChoice'], 'deterministic digest manifest')
    if (applyOk === false) {
      if (finalTargets !== null) {
        throw new Error('an approved failure carries null finalTargets')
      }

      return
    }
  } else if (manifest !== null) {
    throw new Error('a non-approved branch carries a null manifest')
  }
  if (!Array.isArray(finalTargets)) {
    throw new Error('finalTargets must be the ordinal-target-sorted projection')
  }
  if (!isOrdinalSortedUnique(finalTargets.map((item) => item.target))) {
    throw new Error('finalTargets must be ordinal-target sorted and duplicate-free')
  }
  for (const item of finalTargets) {
    requireExactKeys(item, ['kind', 'mode', 'rawSha256', 'target'], 'deterministic digest final target')
  }
}

function deriveDialogueFacts({ applyRequestOrdinals, approvalBranch, approvalOrdinal }) {
  const approvalBeforeApply = approvalBranch !== 'approved'
    ? applyRequestOrdinals.length === 0
    : applyRequestOrdinals.every((ordinal) => approvalOrdinal !== null && approvalOrdinal < ordinal)
  const denialNoApply = approvalBranch !== 'denied' || applyRequestOrdinals.length === 0

  return { approvalBeforeApply, denialNoApply }
}

const DIALOGUE_FACT_KEYS = ['allActionsDisclosed', 'ambiguitiesAsked', 'electionPresented', 'approvalBeforeApply', 'denialNoApply']
const LIFECYCLE_FACT_KEYS = ['approvalApplyCardinality', 'resultPresented', 'unresolvedPresented', 'externalWriterWindowDisclosed']
const RESULT_ROW_KEYS = ['host', 'version', 'scenario', 'controllerEnabled', 'repetitions', 'baselineManifestSha256', 'scenarioManifestSha256', 'scenarioRootDigest', 'runPluginRootDigest', 'semanticClassifications', 'approvalBranch', 'dialogueFacts', 'lifecycleFacts', 'semanticDecisionSource', 'deterministicDigest', 'terminalRepositorySha256', 'passed']

function validateRunRecord(record) {
  requireExactKeys(record, ['approvalBranch', 'baselineManifestSha256', 'controllerEnabled', 'host', 'repetition', 'runPluginRootDigest', 'scenario', 'scenarioManifestSha256', 'scenarioRootDigest', 'version'], 'run record')
  if (!['claude-code', 'codex'].includes(record.host) || typeof record.version !== 'string' || record.version.trim() === '') {
    throw new Error('run record host identity is invalid')
  }
  if (!SCENARIO_IDS.includes(record.scenario) || typeof record.controllerEnabled !== 'boolean' || ![1, 2, 3].includes(record.repetition)) {
    throw new Error('run record scenario identity is invalid')
  }
  if (record.controllerEnabled === false && record.repetition !== 1) {
    throw new Error('run record disabled repetition must be one')
  }
  if (!['approved', 'denied', 'deferred', 'unavailable', 'auto-denied'].includes(record.approvalBranch)) {
    throw new Error('run record approval branch is invalid')
  }
  for (const digestKey of ['baselineManifestSha256', 'scenarioManifestSha256', 'scenarioRootDigest']) {
    if (!HEX64_PATTERN.test(record[digestKey])) {
      throw new Error(`run record ${digestKey} is invalid`)
    }
  }
  if (record.controllerEnabled ? !HEX64_PATTERN.test(record.runPluginRootDigest) : record.runPluginRootDigest !== null) {
    throw new Error('run record runPluginRootDigest carrier is invalid')
  }
}

function validateResultRecord(record) {
  requireExactKeys(record, ['deterministicDigest', 'dialogueFacts', 'lifecycleFacts', 'passed', 'semanticActionDispositions', 'semanticClassifications', 'semanticDecisionSource', 'semanticDecisions', 'semanticRepairOracles', 'structuredResult', 'terminalRepositorySha256'], 'result record')
  requireExactKeys(record.dialogueFacts, DIALOGUE_FACT_KEYS, 'result record dialogueFacts')
  requireExactKeys(record.lifecycleFacts, LIFECYCLE_FACT_KEYS, 'result record lifecycleFacts')
  for (const key of DIALOGUE_FACT_KEYS) {
    if (typeof record.dialogueFacts[key] !== 'boolean') {
      throw new Error(`result record dialogue fact ${key} must be boolean`)
    }
  }
  for (const key of LIFECYCLE_FACT_KEYS) {
    if (typeof record.lifecycleFacts[key] !== 'boolean') {
      throw new Error(`result record lifecycle fact ${key} must be boolean`)
    }
  }
  if (record.semanticDecisionSource !== 'model' || typeof record.passed !== 'boolean') {
    throw new Error('result record ownership fields are invalid')
  }
  if (record.deterministicDigest !== null && !HEX64_PATTERN.test(record.deterministicDigest)) {
    throw new Error('result record deterministicDigest is invalid')
  }
  if (!HEX64_PATTERN.test(record.terminalRepositorySha256)) {
    throw new Error('result record terminalRepositorySha256 carrier is invalid')
  }
  for (const arrayKey of ['semanticClassifications', 'semanticDecisions', 'semanticActionDispositions', 'semanticRepairOracles']) {
    if (!Array.isArray(record[arrayKey])) {
      throw new Error(`result record ${arrayKey} must be an array`)
    }
  }
}

function validateRepositoryAttestation(record) {
  requireExactKeys(record, ['expectedSha256', 'observed', 'observedSha256'], 'repository attestation')
  if (!HEX64_PATTERN.test(record.expectedSha256) || !HEX64_PATTERN.test(record.observedSha256)) {
    throw new Error('repository attestation digests are invalid')
  }
  validateRepositoryObject(record.observed, 'repository attestation observed')
  if (sha256(Buffer.from(canonicalJson(record.observed), 'utf8')) !== record.observedSha256) {
    throw new Error('repository attestation observed digest differs from the observed object')
  }
}

function validateEvidenceManifest(record) {
  requireExactKeys(record, ['evidenceManifestSha256', 'files'], 'evidence manifest')
  if (!Array.isArray(record.files) || !isOrdinalSortedUnique(record.files.map((item) => item.path))) {
    throw new Error('evidence manifest files must be duplicate-free and ordinal-path sorted')
  }
  for (const item of record.files) {
    requireExactKeys(item, ['path', 'sha256'], 'evidence manifest file item')
    if (!HEX64_PATTERN.test(item.sha256)) {
      throw new Error('evidence manifest file digest is invalid')
    }
  }
  if (sha256(Buffer.from(canonicalJson({ files: record.files }), 'utf8')) !== record.evidenceManifestSha256) {
    throw new Error('evidenceManifestSha256 differs from the canonical files serialization')
  }
}

function validateSummary(record) {
  requireExactKeys(record, ['evidenceManifests', 'rows'], 'summary')
  for (const row of record.rows) {
    requireExactKeys(row, RESULT_ROW_KEYS, 'summary row')
    if (!HEX64_PATTERN.test(row.scenarioManifestSha256)) {
      throw new Error('summary row scenarioManifestSha256 carrier is invalid')
    }
    if (row.terminalRepositorySha256 !== null && !HEX64_PATTERN.test(row.terminalRepositorySha256)) {
      throw new Error('summary row terminalRepositorySha256 carrier is invalid')
    }
    if (row.controllerEnabled ? row.repetitions !== 3 : row.repetitions !== 1) {
      throw new Error('summary row repetitions literal is invalid')
    }
  }
  for (let index = 1; index < record.rows.length; index += 1) {
    const previous = record.rows[index - 1]
    const current = record.rows[index]
    if (previous.host === current.host && previous.scenario === current.scenario && !(previous.controllerEnabled === false && current.controllerEnabled === true)) {
      throw new Error('summary rows must order controllerEnabled false before true within one cell')
    }
  }
  for (const item of record.evidenceManifests) {
    requireExactKeys(item, ['evidenceManifestSha256', 'host', 'mode', 'repetition', 'scenario'], 'summary evidence manifest item')
    if (!['enabled', 'disabled'].includes(item.mode) || !HEX64_PATTERN.test(item.evidenceManifestSha256)) {
      throw new Error('summary evidence manifest item is invalid')
    }
  }
}

function validateTranscriptLine(record) {
  requireExactKeys(record, ['kind', 'ordinal', 'payloadBase64'], 'transcript line')
  if (!['input', 'host-event', 'structured-output'].includes(record.kind) || !Number.isSafeInteger(record.ordinal) || record.ordinal < 1 || !isCanonicalBase64(record.payloadBase64)) {
    throw new Error('transcript line is invalid')
  }
}

function validateProxyTraceLine(record) {
  requireExactKeys(record, ['exitCode', 'ordinal', 'requestBase64', 'stderrBase64', 'stdoutBase64'], 'proxy trace line')
  if (!Number.isSafeInteger(record.ordinal) || record.ordinal < 1 || !Number.isSafeInteger(record.exitCode)) {
    throw new Error('proxy trace line ordinals are invalid')
  }
  for (const key of ['requestBase64', 'stdoutBase64', 'stderrBase64']) {
    if (!isCanonicalBase64(record[key])) {
      throw new Error(`proxy trace line ${key} is invalid`)
    }
  }
}

function checkAttributes(repositoryRoot, paths) {
  const output = execFileSync('git', ['-C', repositoryRoot, 'check-attr', '-z', 'text', 'eol', '--', ...paths], { windowsHide: true })
  const fields = output.toString('utf8').split(LIST_SEPARATOR)
  const result = new Map(paths.map((path) => [path, {}]))
  for (let index = 0; index + 2 < fields.length; index += 3) {
    result.get(fields[index])[fields[index + 1]] = fields[index + 2]
  }

  return result
}

function copiedHostFixture(repositoryRoot) {
  const root = mkdtempSync(join(tmpdir(), 'nightshift-host-fixture-oracle-'))
  const copiedRepositoryRoot = join(root, 'repository')
  const copiedFixtureRoot = join(copiedRepositoryRoot, ...HOST_FIXTURE_DIRECTORY.split('/'))
  mkdirSync(dirname(copiedFixtureRoot), { recursive: true })
  cpSync(join(repositoryRoot, ...HOST_FIXTURE_DIRECTORY.split('/')), copiedFixtureRoot, { recursive: true })

  return { copiedFixtureRoot, copiedRepositoryRoot, root }
}

function createFixtureLink(testContext, target, path, type) {
  try {
    symlinkSync(target, path, type)
  } catch (error) {
    if (process.platform === 'win32' && ['EACCES', 'EPERM', 'UNKNOWN'].includes(error.code)) {
      testContext.skip(`Windows ${type} fixture link creation is unavailable: ${error.code}`)

      return false
    }
    throw error
  }

  return true
}

function runOracleCases(repositoryRoot) {
  const fixturePath = (relativePath) => join(repositoryRoot, ...relativePath.split('/'))

  test('the structured turn schema fixture is protocol-canonical ASCII JSON', () => {
    const { object } = readCanonicalFixture(fixturePath(TURN_SCHEMA_PATH))
    assert.equal(object.type, 'object')
    assert.equal(object.additionalProperties, false)
    assert.equal(Object.hasOwn(object, 'allOf'), false, 'Codex rejects allOf at the structured-output root')
    assert.deepEqual(Object.keys(object.properties).sort(compareOrdinal), ['gateId', 'phase', 'presentation', 'semanticClassifications'])
    assert.deepEqual(object.required, ['gateId', 'phase', 'presentation', 'semanticClassifications'])
    assert.deepEqual(object.properties.phase.enum, ['awaiting-response', 'finished'])
  })

  test('the structured turn schema pins the closed presentation and disclosure grammar', () => {
    const { bytes, object } = readCanonicalFixture(fixturePath(TURN_SCHEMA_PATH))
    const presentation = object.properties.presentation
    assert.equal(presentation.additionalProperties, false)
    assert.deepEqual(Object.keys(presentation.properties).sort(compareOrdinal), ['actionDisclosures', 'ambiguityIds', 'disclosureCodes', 'manifestProposal', 'result'])
    const disclosureKinds = presentation.properties.actionDisclosures.items.anyOf.map((item) => item.properties.kind.const)
    assert.deepEqual(disclosureKinds, ['decoded-content', 'decoded-empty', 'breakout-digest', 'structural-action'])
    const breakout = presentation.properties.actionDisclosures.items.anyOf[2]
    assert.equal(breakout.properties.notice.const, BREAKOUT_DIGEST_NOTICE)
    assert.equal(breakout.properties.extent.const, 'complete-file')
    assert.equal(presentation.properties.actionDisclosures.items.anyOf[1].properties.byteLength.const, 0)
    assert.deepEqual(presentation.properties.disclosureCodes.items.const, 'external-writer-window')
    assert.equal(presentation.properties.disclosureCodes.maxItems, 1)
    const proposal = presentation.properties.manifestProposal.anyOf[1]
    const versionControlOptions = ['track', 'ignore', 'deferred', 'not-required']
    assert.deepEqual(proposal.properties.versionControlOptions.items, { enum: versionControlOptions, type: 'string' })
    assert.equal(proposal.properties.versionControlOptions.minItems, versionControlOptions.length)
    assert.equal(proposal.properties.versionControlOptions.maxItems, versionControlOptions.length)
    assert.deepEqual(proposal.properties.versionControlChoice.enum, ['track', 'ignore', 'deferred', 'not-required'])
    const resultBranches = presentation.properties.result.anyOf
    assert.equal(resultBranches[0].type, 'null')
    assert.deepEqual(resultBranches.slice(1, 6).map((branch) => [branch.properties.approvalBranch.const, branch.properties.reasonCode.const]), [
      ['denied', 'denied'],
      ['deferred', 'deferred'],
      ['unavailable', 'unavailable'],
      ['unavailable', 'guidance-resolution'],
      ['auto-denied', 'auto-denied'],
    ])
    assert.ok(resultBranches.slice(1, 6).every((branch) => branch.type === 'object'))
    assert.equal(resultBranches[6].properties.ok.const, true)
    assert.equal(resultBranches[6].properties.operation.const, 'apply')
    assert.deepEqual(resultBranches[6].properties.outcomes.items.properties.status.enum, ['created', 'edited', 'unwrapped', 'skipped-complete'])
    assert.equal(resultBranches[7].properties.ok.const, false)
    assert.deepEqual(resultBranches[7].properties.phase.enum, ['decode', 'resolve', 'inspect', 'lock', 'prevalidate', 'publish', 'verify', 'restore', 'cleanup'])
    assert.deepEqual(resultBranches[7].properties.code.enum, ['payload-too-large', 'invalid-json', 'invalid-request', 'guidance-resolution', 'template-invalid', 'content-invalid', 'git-policy', 'filesystem', 'ready-failed', 'snapshot-drift', 'invalid-target', 'runtime-marker', 'runtime-lock', 'manifest-invalid', 'recovery-invalid', 'ready-delta', 'restore-failed', 'cleanup-failed'])
    const assertTypedLiterals = (value, path = []) => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => assertTypedLiterals(item, [...path, index]))
      } else if (value !== null && typeof value === 'object') {
        if (Object.hasOwn(value, 'const') || Object.hasOwn(value, 'enum')) {
          assert.equal(typeof value.type, 'string', `literal schema lacks an explicit type at ${path.join('.')}`)
        }
        for (const [key, child] of Object.entries(value)) {
          assertTypedLiterals(child, [...path, key])
        }
      }
    }
    assertTypedLiterals(object)
    const assertStrictObjectGraph = (schema, path = ['root']) => {
      assert.ok(typeof schema.type === 'string' || Array.isArray(schema.anyOf), `schema lacks a type or anyOf at ${path.join('.')}`)
      if (schema.type === 'object') {
        assert.equal(schema.additionalProperties, false, `object schema is open at ${path.join('.')}`)
        const propertyNames = Object.keys(schema.properties ?? {}).sort(compareOrdinal)
        assert.deepEqual([...(schema.required ?? [])].sort(compareOrdinal), propertyNames, `object schema does not require every property at ${path.join('.')}`)
        for (const [name, propertySchema] of Object.entries(schema.properties ?? {})) {
          assertStrictObjectGraph(propertySchema, [...path, 'properties', name])
        }
      }
      if (schema.type === 'array') {
        assertStrictObjectGraph(schema.items, [...path, 'items'])
      }
      for (const [index, branch] of (schema.anyOf ?? []).entries()) {
        assertStrictObjectGraph(branch, [...path, 'anyOf', index])
      }
    }
    assertStrictObjectGraph(object)
    assert.ok(bytes.length <= MAX_HOST_EVENT_FRAME_BYTES, 'the schema itself must stay well below the host framing bound')
  })

  test('the host fixture tree is closed, canonical, digest-pinned, and schema-valid', () => {
    const tree = loadHostFixtureTree(repositoryRoot)
    assert.deepEqual([...tree.scenarios.keys()], SCENARIO_IDS)
    assert.match(tree.scenarioManifestSha256, HEX64_PATTERN)
  })

  test('the host fixture loader rejects a linked expected scenario even when an override lists the closed inventory', (testContext) => {
    const fixture = copiedHostFixture(repositoryRoot)
    try {
      const scenario = join(fixture.copiedFixtureRoot, 'scenarios', `${SCENARIO_IDS[0]}.json`)
      const externalScenario = join(fixture.root, 'external-scenario.json')
      cpSync(scenario, externalScenario)
      rmSync(scenario)
      if (!createFixtureLink(testContext, externalScenario, scenario, 'file')) return
      const expectedFiles = ['manifest.json', ...SCENARIO_IDS.map((scenarioId) => `scenarios/${scenarioId}.json`)].sort(compareOrdinal)

      assert.throws(() => loadHostFixtureTree(fixture.copiedRepositoryRoot, { list: () => expectedFiles }), /fixture.*(?:link|canonical|ordinary|confined)/i)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('the host fixture loader rejects linked fixture root and scenarios directories', (testContext) => {
    const fixture = copiedHostFixture(repositoryRoot)
    try {
      const externalRoot = join(fixture.root, 'external-root')
      cpSync(fixture.copiedFixtureRoot, externalRoot, { recursive: true })
      rmSync(fixture.copiedFixtureRoot, { force: true, recursive: true })
      if (!createFixtureLink(testContext, externalRoot, fixture.copiedFixtureRoot, process.platform === 'win32' ? 'junction' : 'dir')) return

      assert.throws(() => loadHostFixtureTree(fixture.copiedRepositoryRoot), /fixture.*(?:link|canonical|ordinary|confined)/i)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }

    const scenariosFixture = copiedHostFixture(repositoryRoot)
    try {
      const scenarios = join(scenariosFixture.copiedFixtureRoot, 'scenarios')
      const externalScenarios = join(scenariosFixture.root, 'external-scenarios')
      cpSync(scenarios, externalScenarios, { recursive: true })
      rmSync(scenarios, { force: true, recursive: true })
      if (!createFixtureLink(testContext, externalScenarios, scenarios, process.platform === 'win32' ? 'junction' : 'dir')) return

      assert.throws(() => loadHostFixtureTree(scenariosFixture.copiedRepositoryRoot), /fixture.*(?:link|canonical|ordinary|confined)/i)
    } finally {
      rmSync(scenariosFixture.root, { force: true, recursive: true })
    }
  })

  test('the host fixture loader rejects a directory at an expected fixture-file path before reading it', () => {
    const fixture = copiedHostFixture(repositoryRoot)
    try {
      const scenario = join(fixture.copiedFixtureRoot, 'scenarios', `${SCENARIO_IDS[0]}.json`)
      rmSync(scenario)
      mkdirSync(scenario)
      const expectedFiles = ['manifest.json', ...SCENARIO_IDS.map((scenarioId) => `scenarios/${scenarioId}.json`)].sort(compareOrdinal)

      assert.throws(() => loadHostFixtureTree(fixture.copiedRepositoryRoot, { list: () => expectedFiles }), /Fixture file is not an ordinary canonical confined entry/)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test('fixture regeneration depends on the recipe seam instead of the cases registrar', () => {
    const generatorSource = readFileSync(fixturePath('tests/regenerate-init-backlog-host-fixtures.js'), 'utf8')
    const recipeSource = readFileSync(fixturePath('tests/init-backlog-controller/host-fixture-recipes.js'), 'utf8')
    assert.match(generatorSource, /host-fixture-recipes/)
    assert.doesNotMatch(generatorSource, /oracles\.cases/)
    assert.doesNotMatch(recipeSource, /node:test/)
  })

  test('every committed scenario fixture equals its independently expanded recipe image', () => {
    const tree = loadHostFixtureTree(repositoryRoot)
    const expected = buildExpectedScenarios(repositoryRoot)
    for (const scenarioId of SCENARIO_IDS) {
      assert.deepEqual(tree.scenarios.get(scenarioId).object, expected.get(scenarioId), `scenario fixture drifted: ${scenarioId}`)
    }
  })

  test('no recipe token survives in the committed host fixtures', () => {
    const tokens = ['T(', 'ENRICHED', 'STALE', 'AMBIGUOUS', 'WRAPPED', 'LEGACY', 'DRIFT', 'D(', 'F(', 'QW-COMPLETE', 'QW-READY-REPAIR', 'QW-AMBIGUOUS', 'FEATURES-COMPLETE', 'QW-LEGACY-COMPLETE', 'NONE']
    const sweep = (value, key, relativePath) => {
      if (Array.isArray(value)) {
        for (const item of value) {
          sweep(item, key, relativePath)
        }
      } else if (value !== null && typeof value === 'object') {
        for (const [childKey, childValue] of Object.entries(value)) {
          sweep(childValue, childKey, relativePath)
        }
      } else if (typeof value === 'string' && !/Base64$/.test(key ?? '') && !/Sha256$/.test(key ?? '')) {
        for (const token of tokens) {
          assert.equal(value.includes(token), false, `recipe token ${token} survives in ${relativePath}`)
        }
      }
    }
    for (const relativePath of COMMITTED_FIXTURE_LEAVES.filter((leaf) => leaf.startsWith(HOST_FIXTURE_DIRECTORY))) {
      sweep(JSON.parse(readFileSync(fixturePath(relativePath), 'utf8')), null, relativePath)
    }
  })

  test('every scenario field and digest is mutation-pinned', () => {
    const tree = loadHostFixtureTree(repositoryRoot)
    for (const scenarioId of SCENARIO_IDS) {
      const { manifestItem, object } = tree.scenarios.get(scenarioId)
      const mutations = []
      const walk = (value, path) => {
        if (Array.isArray(value)) {
          mutations.push([path, [...value, 'nightshift-mutation']])
          value.forEach((item, index) => walk(item, [...path, index]))
        } else if (value !== null && typeof value === 'object') {
          for (const key of Object.keys(value)) {
            walk(value[key], [...path, key])
          }
        } else {
          mutations.push([path, typeof value === 'string' ? `${value}x` : typeof value === 'number' ? value + 1 : typeof value === 'boolean' ? !value : 0])
        }
      }
      walk(object, [])
      assert.ok(mutations.length > 20, `scenario ${scenarioId} must expose per-field mutations`)
      for (const [path, replacement] of mutations) {
        const clone = JSON.parse(JSON.stringify(object))
        let cursor = clone
        for (const step of path.slice(0, -1)) {
          cursor = cursor[step]
        }
        if (path.length === 0) {
          continue
        }
        cursor[path[path.length - 1]] = replacement
        assert.notEqual(sha256(Buffer.from(canonicalJson(clone), 'utf8')), manifestItem.fileSha256, `mutation at ${path.join('.')} must change fileSha256 for ${scenarioId}`)
      }
      const repositoryMutation = JSON.parse(JSON.stringify(object.repository))
      repositoryMutation.git.kind = repositoryMutation.git.kind === 'git' ? 'non-git' : 'git'
      assert.notEqual(sha256(Buffer.from(canonicalJson(repositoryMutation), 'utf8')), manifestItem.posixScenarioRootSha256)
      assert.notEqual(sha256(Buffer.from(canonicalJson(windowsRepositoryImage(repositoryMutation)), 'utf8')), manifestItem.windowsScenarioRootSha256)
    }
  })

  test('the windows scenario-root digest differs from the posix digest only through null modes', () => {
    const tree = loadHostFixtureTree(repositoryRoot)
    for (const scenarioId of SCENARIO_IDS) {
      const { manifestItem, object } = tree.scenarios.get(scenarioId)
      const windowsImage = windowsRepositoryImage(object.repository)
      assert.ok(windowsImage.entries.every((entry) => entry.mode === null))
      if (object.repository.entries.length > 0) {
        assert.notEqual(manifestItem.posixScenarioRootSha256, manifestItem.windowsScenarioRootSha256, `${scenarioId} platform digests must separate stored and null modes`)
      } else {
        assert.equal(manifestItem.posixScenarioRootSha256, manifestItem.windowsScenarioRootSha256, `${scenarioId} has no entry mode to normalize`)
      }
    }
  })

  test('the host fixture loader rejects manifest and tree mutations', () => {
    const tree = loadHostFixtureTree(repositoryRoot)
    const manifestBytes = readFileSync(fixturePath(`${HOST_FIXTURE_DIRECTORY}/manifest.json`))
    const withManifest = (mutate) => {
      const manifest = JSON.parse(manifestBytes.toString('utf8'))
      mutate(manifest)
      const mutatedBytes = Buffer.from(canonicalJson(manifest) + '\n', 'utf8')

      return () => loadHostFixtureTree(repositoryRoot, {
        read: (relativePath) => relativePath === 'manifest.json'
          ? { bytes: mutatedBytes, object: JSON.parse(mutatedBytes.toString('utf8')) }
          : readCanonicalFixture(fixturePath(`${HOST_FIXTURE_DIRECTORY}/${relativePath}`)),
      })
    }
    assert.throws(withManifest((manifest) => { manifest.scenarios[0].fileSha256 = '0'.repeat(64) }), /fileSha256/)
    assert.throws(withManifest((manifest) => { manifest.scenarios[0].posixScenarioRootSha256 = '0'.repeat(64) }), /posixScenarioRootSha256/)
    assert.throws(withManifest((manifest) => { manifest.scenarios[0].windowsScenarioRootSha256 = '0'.repeat(64) }), /windowsScenarioRootSha256/)
    assert.throws(withManifest((manifest) => { manifest.scenarios.reverse() }), /ordinal sorted/)
    assert.throws(withManifest((manifest) => { manifest.scenarios[1].scenarioId = manifest.scenarios[0].scenarioId; manifest.scenarios[1].path = manifest.scenarios[0].path }), /duplicate-free|inventory/)
    assert.throws(withManifest((manifest) => { manifest.scenarios[0].path = 'scenarios/renamed.json' }), /path is invalid/)
    assert.throws(withManifest((manifest) => { manifest.extra = true }), /exactly the keys/)
    assert.throws(withManifest((manifest) => { manifest.schemaVersion = 2 }), /identity fields/)
    assert.throws(withManifest((manifest) => { manifest.scenarios.pop() }), /inventory/)
    assert.throws(() => loadHostFixtureTree(repositoryRoot, { list: () => ['manifest.json', 'scenarios/extra.json', ...SCENARIO_IDS.map((scenarioId) => `scenarios/${scenarioId}.json`)].sort(compareOrdinal) }), /file set differs/)
    assert.throws(() => loadHostFixtureTree(repositoryRoot, { list: () => ['manifest.json', ...SCENARIO_IDS.slice(1).map((scenarioId) => `scenarios/${scenarioId}.json`)].sort(compareOrdinal) }), /file set differs/)
    assert.equal(tree.scenarioManifestSha256, sha256(Buffer.from(canonicalJson(JSON.parse(manifestBytes.toString('utf8'))), 'utf8')))
  })

  test('the scenario validator rejects the named negative semantic transitions', () => {
    const expected = buildExpectedScenarios(repositoryRoot)
    const staleScenario = expected.get('existing-stale-manifest-deferred')
    const enrichedScenario = expected.get('existing-enriched-denied')
    const withMutation = (base, mutate) => {
      const clone = JSON.parse(JSON.stringify(base))
      mutate(clone)

      return () => validateScenarioObject(clone, clone.scenarioId)
    }
    assert.throws(withMutation(staleScenario, (clone) => { clone.oracles.semanticRepairOracles = [] }), /approved-repair requires/)
    assert.throws(withMutation(staleScenario, (clone) => { clone.oracles.semanticActionDispositions[0].disposition = 'deferred-repair' }), /deferred-repair|repair oracle/)
    assert.throws(withMutation(staleScenario, (clone) => {
      clone.oracles.semanticActionDispositions[0].disposition = 'partial-repair'
    }), /partial-repair/)
    assert.throws(withMutation(enrichedScenario, (clone) => {
      clone.oracles.semanticRepairOracles = JSON.parse(JSON.stringify(staleScenario.oracles.semanticRepairOracles))
      clone.oracles.semanticActionDispositions[0].disposition = 'approved-repair'
    }), /outside the expected repair|complete prose|approved-repair/)
    assert.throws(withMutation(enrichedScenario, (clone) => {
      clone.oracles.semanticRepairOracles = JSON.parse(JSON.stringify(staleScenario.oracles.semanticRepairOracles))
    }), /complete prose|repair disposition/)
    assert.throws(withMutation(staleScenario, (clone) => {
      clone.oracles.semanticRepairOracles[0].actions[0].beforeBase64 = Buffer.from('unexpected bytes\n', 'utf8').toString('base64')
    }), /outside the expected repair/)
    const ambiguousScenario = expected.get('existing-ambiguous-unavailable')
    assert.throws(withMutation(ambiguousScenario, (clone) => {
      clone.oracles.semanticDecisions[0].conceptIds = clone.oracles.semanticDecisions[0].conceptIds.slice(1)
    }), /defers the complete concept set/)
    assert.throws(withMutation(staleScenario, (clone) => { clone.oracles.terminalRepositories.enabled.base.git.kind = 'git' }), /non-approved enabled terminal|trackedPaths|initial image/)
    assert.throws(withMutation(staleScenario, (clone) => { clone.conversation.approvalResponse = APPROVAL_RESPONSES.approved }), /exact approval response/)
    assert.throws(withMutation(staleScenario, (clone) => { clone.oracles.approvalBranch = 'unavailable' }), /null approval response/)
  })

  test('terminal members carry host-dependent guidance entries and the deferred marker expectation', () => {
    const tree = loadHostFixtureTree(repositoryRoot)
    const compositions = loadTemplateCompositions(repositoryRoot)
    const guidanceImages = { 'claude-code': compositions.get('guidance.claude'), codex: compositions.get('guidance.codex') }
    const platformEolGuidanceImages = { 'claude-code': materializeWindowsLivePlatformEol(guidanceImages['claude-code']), codex: materializeWindowsLivePlatformEol(guidanceImages.codex) }
    const guidanceNames = { 'claude-code': 'CLAUDE.md', codex: 'AGENTS.md' }
    for (const scenarioId of SCENARIO_IDS) {
      const { object } = tree.scenarios.get(scenarioId)
      const platformEolSourced = scenarioId === 'existing-legacy-history-approved'
      for (const mode of ['enabled', 'disabled']) {
        const member = object.oracles.terminalRepositories[mode]
        for (const host of ['claude-code', 'codex']) {
          if (GUIDANCE_SCENARIO_IDS.includes(scenarioId)) {
            const expectedImage = platformEolSourced ? platformEolGuidanceImages[host] : guidanceImages[host]
            assert.deepEqual(member.hostEntries[host], [{ contentBase64: expectedImage.toString('base64'), kind: 'file', mode: 420, path: guidanceNames[host] }], `${scenarioId} ${mode} ${host} must carry its host guidance composition in its derived newline style`)
            if (platformEolSourced) {
              assert.notEqual(member.hostEntries[host][0].contentBase64, guidanceImages[host].toString('base64'), `${scenarioId} ${mode} ${host} platform-EOL-sourced guidance must not regress to LF`)
            }
          } else {
            assert.deepEqual(member.hostEntries[host], [], `${scenarioId} ${mode} ${host} must carry no host-dependent entry`)
          }
          const merged = selectTerminalExpectation(member, host)
          assert.deepEqual(merged.git, member.base.git)
          assert.equal(merged.entries.some((entry) => entry.path === ELECTION_MARKER_PATH), false, 'the marker file is never an expected entry')
          assert.deepEqual(merged.entries.map((entry) => entry.path), [...merged.entries.map((entry) => entry.path)].sort(compareOrdinal))
          assert.equal(merged.entries.length, member.base.entries.length + member.hostEntries[host].length)
        }
        const expectedMarker = scenarioId === 'fresh-plans-only-election-deferred-approved' && mode === 'enabled' ? { state: 'deferred' } : null
        assert.deepEqual(member.marker, expectedMarker, `${scenarioId} ${mode} marker expectation drifted`)
      }
    }
  })

  test('the live election marker is judged structurally, never byte-exactly', () => {
    const root = '/runs/7/repo'
    const markerObject = { protocolVersion: 1, root, snapshotId: 'a'.repeat(64), state: 'deferred' }
    const markerBytes = Buffer.from(canonicalJson(markerObject) + '\n', 'utf8')
    validateLiveElectionMarker({ bytes: markerBytes, expectedState: 'deferred', mode: 384, platform: 'linux', root })
    validateLiveElectionMarker({ bytes: markerBytes, expectedState: 'deferred', mode: null, platform: 'win32', root })
    const withBytes = (mutate) => {
      const clone = JSON.parse(JSON.stringify(markerObject))
      mutate(clone)

      return Buffer.from(canonicalJson(clone) + '\n', 'utf8')
    }
    assert.throws(() => validateLiveElectionMarker({ bytes: withBytes((clone) => { clone.state = 'track' }), expectedState: 'deferred', mode: 384, platform: 'linux', root }), /structural expectation/)
    assert.throws(() => validateLiveElectionMarker({ bytes: withBytes((clone) => { clone.root = '/runs/8/repo' }), expectedState: 'deferred', mode: 384, platform: 'linux', root }), /structural expectation/)
    assert.throws(() => validateLiveElectionMarker({ bytes: withBytes((clone) => { clone.snapshotId = 'nope' }), expectedState: 'deferred', mode: 384, platform: 'linux', root }), /structural expectation/)
    assert.throws(() => validateLiveElectionMarker({ bytes: withBytes((clone) => { clone.extra = true }), expectedState: 'deferred', mode: 384, platform: 'linux', root }), /exactly the keys/)
    assert.throws(() => validateLiveElectionMarker({ bytes: Buffer.from(canonicalJson(markerObject), 'utf8'), expectedState: 'deferred', mode: 384, platform: 'linux', root }), /one LF/)
    assert.throws(() => validateLiveElectionMarker({ bytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), markerBytes]), expectedState: 'deferred', mode: 384, platform: 'linux', root }), /BOM/)
    assert.throws(() => validateLiveElectionMarker({ bytes: Buffer.from(JSON.stringify(markerObject, null, 2) + '\n', 'utf8'), expectedState: 'deferred', mode: 384, platform: 'linux', root }), /canonical JSON/)
    assert.throws(() => validateLiveElectionMarker({ bytes: markerBytes, expectedState: 'deferred', mode: 420, platform: 'linux', root }), /0o600/)
    assert.throws(() => validateLiveElectionMarker({ bytes: markerBytes, expectedState: 'deferred', mode: 384, platform: 'win32', root }), /0o600/)
  })

  test('the terminal member schema rejects the ruled negative mutations', () => {
    const expected = buildExpectedScenarios(repositoryRoot)
    const trackScenario = expected.get('fresh-empty-track-approved')
    const deferredScenario = expected.get('fresh-plans-only-election-deferred-approved')
    const withMutation = (base, mutate) => {
      const clone = JSON.parse(JSON.stringify(base))
      mutate(clone)

      return () => validateScenarioObject(clone, clone.scenarioId)
    }
    assert.throws(withMutation(trackScenario, (clone) => {
      clone.oracles.terminalRepositories.enabled.hostEntries = { 'claude-code': clone.oracles.terminalRepositories.enabled.hostEntries['claude-code'] }
    }), /exactly the keys/)
    assert.throws(withMutation(trackScenario, (clone) => {
      clone.oracles.terminalRepositories.enabled.hostEntries.macos = []
    }), /exactly the keys/)
    assert.throws(withMutation(trackScenario, (clone) => {
      const entries = clone.oracles.terminalRepositories.enabled.hostEntries['claude-code']
      entries.push({ ...entries[0] })
    }), /duplicate-free and ordinal-path sorted/)
    assert.throws(withMutation(trackScenario, (clone) => {
      const entries = clone.oracles.terminalRepositories.enabled.hostEntries['claude-code']
      entries.unshift({ contentBase64: '', kind: 'file', mode: 420, path: 'ZZZ.md' })
    }), /ordinal-path sorted/)
    assert.throws(withMutation(trackScenario, (clone) => {
      clone.oracles.terminalRepositories.enabled.hostEntries['claude-code'][0].path = '.gitignore'
    }), /collides with a base entry/)
    assert.throws(withMutation(trackScenario, (clone) => {
      clone.oracles.terminalRepositories.enabled.hostEntries.codex[0].path = ELECTION_MARKER_PATH
    }), /election marker path/)
    assert.throws(withMutation(trackScenario, (clone) => {
      const member = clone.oracles.terminalRepositories.enabled
      member.base.entries.push({ contentBase64: '', kind: 'file', mode: 420, path: ELECTION_MARKER_PATH })
      member.base.entries.sort((left, right) => compareOrdinal(left.path, right.path))
    }), /election marker path/)
    assert.throws(withMutation(deferredScenario, (clone) => {
      clone.oracles.terminalRepositories.enabled.marker = { state: 'sometimes' }
    }), /marker\.state is invalid/)
    assert.throws(withMutation(trackScenario, (clone) => {
      clone.oracles.terminalRepositories.enabled.marker = { state: 'deferred' }
    }), /outside an approved deferred election/)
    assert.throws(withMutation(deferredScenario, (clone) => {
      clone.oracles.terminalRepositories.disabled.marker = { state: 'deferred' }
    }), /outside an approved deferred election/)
    assert.throws(withMutation(expected.get('existing-enriched-denied'), (clone) => {
      clone.oracles.terminalRepositories.enabled.hostEntries.codex = [{ contentBase64: '', kind: 'file', mode: 420, path: 'AGENTS.md' }]
    }), /initial image with no host-dependent effect/)
  })

  test('the import case matrix equals its exact authoring expansion', () => {
    const { object } = readCanonicalFixture(fixturePath(`${IMPORT_FIXTURE_DIRECTORY}/cases.json`))
    const expected = buildExpectedImportCases()
    assert.equal(expected.length, 42)
    assert.deepEqual(object, expected)
    const caseIds = object.map((entry) => entry.caseId)
    assert.equal(new Set(caseIds).size, 42)
    const sentinels = object.map((entry) => entry.expectedSentinel).filter((sentinel) => sentinel !== null)
    assert.equal(new Set(sentinels).size, sentinels.length, 'every non-null sentinel must be unique')
    for (const entry of object) {
      requireExactKeys(entry, ['adapterBase64', 'caseId', 'expectedSentinel', 'files'], 'import case')
      assert.ok(isCanonicalBase64(entry.adapterBase64))
      assert.ok(entry.expectedSentinel === null || /^[0-9a-f]{32}$/.test(entry.expectedSentinel))
      assert.ok(isOrdinalSortedUnique(entry.files.map((file) => file.path)), `${entry.caseId} files must be ordinal-path sorted`)
      const sentinel = importSentinel(entry.caseId)
      const adapter = Buffer.from(entry.adapterBase64, 'base64').toString('utf8')
      assert.equal(adapter.includes(sentinel), false, `${entry.caseId} sentinel must never appear in the adapter`)
      const carriers = entry.files.filter((file) => Buffer.from(file.contentBase64, 'base64').toString('utf8').includes(sentinel))
      assert.equal(carriers.length, 1, `${entry.caseId} sentinel must occur in exactly one imported file`)
    }
  })

  test('the import whitespace coverage expands the exact ordered code-point array', () => {
    const { object } = readCanonicalFixture(fixturePath(`${IMPORT_FIXTURE_DIRECTORY}/cases.json`))
    const whitespaceCases = object.slice(17)
    assert.equal(whitespaceCases.length, 25)
    assert.deepEqual(whitespaceCases.map((entry) => entry.caseId), WHITESPACE_CODE_POINTS.map((codePoint) => `whitespace-${codePoint.toString(16).padStart(4, '0')}`))
    for (const [index, entry] of whitespaceCases.entries()) {
      const adapter = Buffer.from(entry.adapterBase64, 'base64').toString('utf8')
      assert.equal(adapter, `# CLAUDE.md\n\nprefix${String.fromCodePoint(WHITESPACE_CODE_POINTS[index])}@imports/${entry.caseId}.md\n`)
      assert.equal(entry.expectedSentinel, importSentinel(entry.caseId))
    }
  })

  test('the compatibility record pins the cases digest with both probe fields null', () => {
    const casesBytes = readFileSync(fixturePath(`${IMPORT_FIXTURE_DIRECTORY}/cases.json`))
    const casesSha256 = sha256(casesBytes.subarray(0, casesBytes.length - 1))
    const { object } = readCanonicalFixture(fixturePath(`${IMPORT_FIXTURE_DIRECTORY}/compatibility.json`))
    validateCompatibilityRecord(object, casesSha256)
    assert.deepEqual(object, { casesSha256, claudeVersion: null, probedOn: null, schemaVersion: 1 })
    validateCompatibilityRecord({ casesSha256, claudeVersion: '2.1.0 (Claude Code)', probedOn: '2026-08-27', schemaVersion: 1 }, casesSha256)
    assert.throws(() => validateCompatibilityRecord({ casesSha256, claudeVersion: '2.1.0', probedOn: null, schemaVersion: 1 }, casesSha256), /both/)
    assert.throws(() => validateCompatibilityRecord({ casesSha256, claudeVersion: null, probedOn: '2026-08-27', schemaVersion: 1 }, casesSha256), /both/)
    assert.throws(() => validateCompatibilityRecord({ casesSha256: '0'.repeat(64), claudeVersion: null, probedOn: null, schemaVersion: 1 }, casesSha256), /identity/)
  })

  test('the import fixture directory is closed to its two leaves', () => {
    assert.deepEqual(listTree(fixturePath(IMPORT_FIXTURE_DIRECTORY)), ['cases.json', 'compatibility.json'])
    const evalLeaves = listTree(fixturePath(EVAL_FIXTURE_DIRECTORY))
    assert.ok(evalLeaves.includes('turn.schema.json'))
    for (const leaf of evalLeaves) {
      assert.ok(['controller-proxy.js', 'turn.schema.json'].includes(leaf), `unexpected evaluation fixture leaf: ${leaf}`)
    }
  })

  test('every closed fixture leaf is attribute-pinned to unset text and unspecified eol', () => {
    const attributes = checkAttributes(repositoryRoot, CLOSED_FUTURE_FIXTURE_LEAVES)
    for (const leaf of CLOSED_FUTURE_FIXTURE_LEAVES) {
      assert.equal(attributes.get(leaf).text, 'unset', `${leaf} must carry -text`)
      assert.equal(attributes.get(leaf).eol, 'unspecified', `${leaf} must carry no eol attribute`)
    }
  })

  test('the exact host entrypoint envelopes are pinned per host', () => {
    const sample = { controllerProxy: '/runs/1/enabled-plugin/skills/init-backlog/init-backlog.js', scenarioPrompt: INITIAL_PROMPT, turnSchema: '/runs/1/turn.schema.json' }
    const claudeEnvelope = buildEvaluationEnvelope('claude-code', sample)
    const codexEnvelope = buildEvaluationEnvelope('codex', sample)
    assert.equal(claudeEnvelope, canonicalJson({ nightshiftEvaluation: { controllerProxy: sample.controllerProxy, entrypoint: '/nightshift:init-backlog', instructions: ENVELOPE_INSTRUCTIONS, turnSchema: sample.turnSchema, version: 1 }, scenarioPrompt: INITIAL_PROMPT }))
    assert.ok(claudeEnvelope.includes('"entrypoint":"/nightshift:init-backlog"'))
    assert.ok(codexEnvelope.includes('"entrypoint":"$nightshift:init-backlog"'))
    assert.notEqual(claudeEnvelope, codexEnvelope)
    assert.deepEqual(ENVELOPE_INSTRUCTIONS, [
      'Invoke the entrypoint.',
      'Route every controller call through controllerProxy.',
      'At each user or manifest decision boundary, emit one turnSchema object and stop.',
      'Emit only the turnSchema object; put every presented carrier in its presentation field.',
    ])
    const reordered = canonicalJson({ nightshiftEvaluation: { controllerProxy: sample.controllerProxy, entrypoint: '/nightshift:init-backlog', instructions: [...ENVELOPE_INSTRUCTIONS].reverse(), turnSchema: sample.turnSchema, version: 1 }, scenarioPrompt: INITIAL_PROMPT })
    assert.notEqual(claudeEnvelope, reordered, 'instruction order is part of the envelope')
  })

  test('host-context gates, responses, and no-inspect branches are pinned', () => {
    assert.deepEqual(HOST_CONTEXTS.codex, { claudeContextSource: null, claudeRootExclusionStatus: null, codexContextSource: 'user-confirmed', codexInvocationDirectory: '.', codexProjectDocMaxBytes: 32768, codexProjectInstructions: [] })
    assert.equal(CODEX_HOST_CONTEXT_CONFIRMATION.startsWith('Confirm fixed guidance candidates AGENTS.override.md and AGENTS.md'), true)
    assert.equal(CODEX_HOST_CONTEXT_CONFIRMATION.endsWith('invocation directory repository root (.).'), true)
    const rootPath = 'CLAUDE.md'
    assert.deepEqual(classifyClaudeInspectAuthorization({ loadedMemoryPaths: [rootPath], rootPath, rootPresent: true, scriptedResponse: null }), { authorization: 'inspect', hostContext: HOST_CONTEXTS.claudePresentRoot })
    assert.deepEqual(classifyClaudeInspectAuthorization({ loadedMemoryPaths: [], rootPath, rootPresent: true, scriptedResponse: null }), { authorization: 'none', reasonCode: 'guidance-resolution' })
    assert.deepEqual(classifyClaudeInspectAuthorization({ loadedMemoryPaths: null, rootPath, rootPresent: true, scriptedResponse: null }), { authorization: 'none', reasonCode: 'guidance-resolution' })
    assert.deepEqual(classifyClaudeInspectAuthorization({ loadedMemoryPaths: null, rootPath, rootPresent: false, scriptedResponse: CLAUDE_ROOT_EXCLUSION_CONFIRMATION }), { authorization: 'inspect', gateId: 'claude-root-exclusion-confirmation', hostContext: HOST_CONTEXTS.claudeMissingRoot })
    assert.deepEqual(classifyClaudeInspectAuthorization({ loadedMemoryPaths: null, rootPath, rootPresent: false, scriptedResponse: null }), { authorization: 'none', reasonCode: 'guidance-resolution' })
    assert.deepEqual(classifyClaudeInspectAuthorization({ loadedMemoryPaths: null, rootPath, rootPresent: false, scriptedResponse: 'Denied.' }), { authorization: 'none', reasonCode: 'guidance-resolution' })
    assert.equal(HOST_CONTROL_RECORDS.disclosureAcknowledgement, '[nightshift-eval-host-control] disclosure recorded; continue.')
    assert.equal(HOST_CONTROL_RECORDS.unavailable, '[nightshift-eval-host-control] no user response is available.')
    assert.equal(HOST_CONTROL_RECORDS.autoDenied, '[nightshift-eval-host-control] manifest approval was auto-denied without a user decision.')
  })

  test('sample structured turns pass and mutated turns fail the closed grammar', () => {
    const digest = 'a'.repeat(64)
    const disclosureTurn = {
      gateId: 'action-disclosure',
      phase: 'awaiting-response',
      presentation: {
        actionDisclosures: [{ actionId: 'p-' + 'a'.repeat(62), chunkCount: 1, chunkIndex: 0, endByte: 5, image: 'after', kind: 'decoded-content', proposalDigest: digest, rawSha256: digest, selection: 'selected', startByte: 0, target: '.claude/QUICK_WINS.md', text: 'hello' }],
        ambiguityIds: [],
        disclosureCodes: [],
        manifestProposal: null,
        result: null,
      },
      semanticClassifications: [],
    }
    validateTurnObject(disclosureTurn)
    const manifestTurn = JSON.parse(JSON.stringify(disclosureTurn))
    manifestTurn.gateId = 'manifest-approval'
    manifestTurn.presentation.manifestProposal = {
      actions: [],
      proposalDispositions: [],
      semanticDecisions: [],
      versionControlChoice: 'not-required',
      versionControlOptions: ['track', 'ignore', 'deferred', 'not-required'],
    }
    validateTurnObject(manifestTurn)
    const finishedTurn = {
      gateId: null,
      phase: 'finished',
      presentation: { actionDisclosures: [], ambiguityIds: [], disclosureCodes: [], manifestProposal: null, result: { approvalBranch: 'denied', reasonCode: 'denied' } },
      semanticClassifications: [],
    }
    validateTurnObject(finishedTurn)
    const approvalBranches = ['approved', 'denied', 'deferred', 'unavailable', 'auto-denied']
    const reasonCodes = ['denied', 'deferred', 'unavailable', 'auto-denied', 'guidance-resolution']
    const allowedNoApplyPairs = new Set(['denied:denied', 'deferred:deferred', 'unavailable:unavailable', 'unavailable:guidance-resolution', 'auto-denied:auto-denied'])
    for (const approvalBranch of approvalBranches) {
      for (const reasonCode of reasonCodes) {
        const candidate = JSON.parse(JSON.stringify(finishedTurn))
        candidate.presentation.result = { approvalBranch, reasonCode }
        if (allowedNoApplyPairs.has(`${approvalBranch}:${reasonCode}`)) {
          validateTurnObject(candidate)
        } else {
          assert.throws(() => validateTurnObject(candidate), /result/)
        }
      }
    }
    const mutate = (base, mutation) => {
      const clone = JSON.parse(JSON.stringify(base))
      mutation(clone)

      return () => validateTurnObject(clone)
    }
    assert.throws(mutate(disclosureTurn, (turn) => { turn.gateId = null }), /gateId/)
    assert.throws(mutate(finishedTurn, (turn) => { turn.gateId = 'manifest-approval' }), /gateId/)
    assert.throws(mutate(finishedTurn, (turn) => { turn.presentation.result = null }), /result/)
    assert.throws(mutate(disclosureTurn, (turn) => { turn.presentation.result = { approvalBranch: 'denied', reasonCode: 'denied' } }), /result/)
    assert.throws(mutate(disclosureTurn, (turn) => { turn.presentation.disclosureCodes = ['other'] }), /disclosureCodes/)
    assert.throws(mutate(disclosureTurn, (turn) => { turn.presentation.disclosureCodes = ['external-writer-window', 'external-writer-window'] }), /disclosureCodes/)
    assert.throws(mutate(disclosureTurn, (turn) => { turn.presentation.actionDisclosures[0].text = '' }), /text/)
    assert.throws(mutate(disclosureTurn, (turn) => { delete turn.presentation.actionDisclosures[0].rawSha256 }), /decoded-content/)
    assert.throws(mutate(disclosureTurn, (turn) => { turn.presentation.actionDisclosures[0].contentBase64 = 'aGk=' }), /decoded-content/)
    assert.throws(mutate(manifestTurn, (turn) => { [turn.presentation.manifestProposal.versionControlOptions[0], turn.presentation.manifestProposal.versionControlOptions[1]] = [turn.presentation.manifestProposal.versionControlOptions[1], turn.presentation.manifestProposal.versionControlOptions[0]] }), /versionControlOptions/)
    assert.throws(mutate(disclosureTurn, (turn) => {
      turn.presentation.actionDisclosures[0] = { actionId: 'p-' + 'a'.repeat(62), afterRawSha256: digest, beforeRawSha256: digest, extent: 'complete-file', kind: 'breakout-digest', notice: 'Images withheld.', proposalDigest: digest, selection: 'selected', target: '.claude/FEATURES.md' }
    }), /breakout-digest/)
  })

  test('finished turns accept production failures and apply successes only', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'nightshift-turn-result-oracle-'))
    try {
      const root = realpathSync.native(scratch)
      const inspection = inspect(root, 'codex', HOST_CONTEXTS.codex, { candidates: [], ownerNonce: 'a'.repeat(32) })
      const turnWith = (result) => ({
        gateId: null,
        phase: 'finished',
        presentation: { actionDisclosures: [], ambiguityIds: [], disclosureCodes: [], manifestProposal: null, result },
        semanticClassifications: [],
      })
      const applySuccess = {
        complete: true,
        host: 'codex',
        hostContext: HOST_CONTEXTS.codex,
        incompleteTargets: [],
        manifestId: 'b'.repeat(64),
        ok: true,
        operation: OPERATION.APPLY,
        outcomes: [],
        postInspect: inspection,
        protocolVersion: 1,
        retainedBackups: [],
        root,
        snapshotId: inspection.snapshotId,
        versionControlChoice: 'not-required',
        warnings: [],
      }
      const inspectSuccess = inspection
      const recoverySuccess = {
        changedPaths: [`.nightshift-init-backlog.lock.9.${'c'.repeat(32)}.new`],
        disposition: 'remove',
        host: 'codex',
        hostContext: HOST_CONTEXTS.codex,
        ok: true,
        operation: OPERATION.RECOVER_APPLY,
        protocolVersion: 1,
        recoveryId: 'd'.repeat(64),
        recoveryKind: 'orphan-lock-stage',
        recoveryTarget: `.nightshift-init-backlog.lock.9.${'c'.repeat(32)}.new`,
        retainedPaths: [],
        root,
        status: 'completed',
        warnings: [],
      }
      const failure = failureRecord({ code: 'invalid-request', detail: 'Request is invalid.', phase: 'decode' })
      for (const result of [applySuccess, inspectSuccess, recoverySuccess, failure]) {
        validateProtocolResultRecord(result)
      }
      validateTurnObject(turnWith(applySuccess))
      validateTurnObject(turnWith(failure))
      assert.throws(() => validateTurnObject(turnWith({ ok: true, operation: OPERATION.APPLY })), /result/i, 'a partial apply result is not a valid turn result')
      assert.throws(() => validateTurnObject(turnWith(inspectSuccess)), /result/i, 'an inspect success is not a valid turn result')
      assert.throws(() => validateTurnObject(turnWith(recoverySuccess)), /result/i, 'a recovery success is not a valid turn result')
      assert.throws(() => validateTurnObject(turnWith({ ...failure, extra: true })), /result/i, 'production failure fields remain closed')
      assert.throws(() => validateTurnObject(turnWith({ ...failure, code: 'filesystem' })), /phase|code/, 'production failure phase and code remain paired')
    } finally {
      rmSync(scratch, { force: true, recursive: true })
    }
  })

  test('decoded-content disclosure chunking covers images exactly and re-fits after re-indexing', () => {
    const base = { actionId: 'p-' + 'b'.repeat(62), image: 'after', proposalDigest: 'c'.repeat(64), selection: 'selected', target: '.claude/FEATURES.md' }
    const smallBytes = Buffer.from('short disclosure image\n', 'utf8')
    const small = buildDecodedContentDisclosures({ ...base, bytes: smallBytes })
    assert.equal(small.items.length, 1)
    assert.deepEqual(reconstructDecodedContent(small.items), smallBytes)
    assert.equal(small.items[0].startByte, 0)
    assert.equal(small.items[0].endByte, smallBytes.length)
    const largeBytes = Buffer.from('x'.repeat(700000), 'utf8')
    const large = buildDecodedContentDisclosures({ ...base, bytes: largeBytes })
    assert.ok(large.items.length >= 3)
    assert.deepEqual(reconstructDecodedContent(large.items), largeBytes)
    for (const item of large.items) {
      assert.ok(disclosureTurnByteLength(item, []) <= MAX_PRESENTATION_CANONICAL_BYTES)
    }
    const largePointCount = [...largeBytes.toString('utf8')].length
    for (const item of large.items.slice(0, -1)) {
      const widened = { ...item, chunkCount: largePointCount, chunkIndex: largePointCount - 1, endByte: item.endByte + 1, text: `${item.text}x` }
      assert.ok(disclosureTurnByteLength(widened, []) > MAX_PRESENTATION_CANONICAL_BYTES, 'every nonfinal chunk must be the maximal pessimistically fitting prefix')
    }
    const multibyte = Buffer.from(String.fromCodePoint(0x10348).repeat(50000), 'utf8')
    const astral = buildDecodedContentDisclosures({ ...base, budget: 120000, bytes: multibyte })
    assert.deepEqual(reconstructDecodedContent(astral.items), multibyte)
    for (const item of astral.items) {
      assert.equal(Buffer.from(item.text, 'utf8').toString('utf8'), item.text, 'every chunk must end at a code-point boundary')
    }
  })

  test('decoded-empty, capacity, and arithmetic boundaries are pinned', () => {
    const base = { actionId: 'p-' + 'd'.repeat(62), image: 'before', proposalDigest: 'e'.repeat(64), selection: 'condition-not-selected', target: '.claude/BUGS.md' }
    const empty = buildDecodedContentDisclosures({ ...base, bytes: Buffer.alloc(0) })
    assert.deepEqual(empty.items, [{ actionId: base.actionId, byteLength: 0, image: 'before', kind: 'decoded-empty', proposalDigest: base.proposalDigest, rawSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', selection: base.selection, target: base.target }])
    assert.deepEqual(reconstructDecodedContent(empty.items), Buffer.alloc(0))
    const capacity = buildDecodedContentDisclosures({ ...base, budget: 100, bytes: Buffer.from('unfitting', 'utf8') })
    assert.deepEqual(capacity, { presentationCapacity: true })
    assert.equal(MAX_PRESENTATION_CANONICAL_BYTES, 320000)
    assert.equal(MAX_HOST_EVENT_FRAME_BYTES, 262144)
    assert.equal(MAX_PRESENTATION_CANONICAL_BYTES * 12 + MAX_HOST_EVENT_FRAME_BYTES, 4102144)
    assert.ok(MAX_PRESENTATION_CANONICAL_BYTES * 12 + MAX_HOST_EVENT_FRAME_BYTES < MAX_HOST_LINE_BYTES)
    const probe = { ...base, bytes: Buffer.from('y'.repeat(4096), 'utf8') }
    const boundaryBudget = disclosureTurnByteLength({ actionId: probe.actionId, chunkCount: 4096, chunkIndex: 4095, endByte: 4096, image: probe.image, kind: 'decoded-content', proposalDigest: probe.proposalDigest, rawSha256: sha256(probe.bytes), selection: probe.selection, startByte: 0, target: probe.target, text: probe.bytes.toString('utf8') }, [])
    const exact = buildDecodedContentDisclosures({ ...probe, budget: boundaryBudget })
    assert.equal(exact.items.length, 1, 'a turn exactly at the presentation bound fits')
    const oneUnder = buildDecodedContentDisclosures({ ...probe, budget: boundaryBudget - 1 })
    assert.equal(oneUnder.items.length, 2, 'one byte below the bound must split the image')
  })

  test('two manifests differing only in election choice and conditional dispositions have different proposal digests', () => {
    const mandatoryId = 'p-' + '1'.repeat(62)
    const electiveId = 'p-' + '2'.repeat(62)
    const baseProposal = (versionControlChoice, electiveDisposition) => ({
      actions: [{ id: mandatoryId, kind: 'create-from-template', mode: 420, newline: null, target: '.gitignore', templateId: 'gitignore.plans' }],
      proposalDispositions: [{ disposition: 'selected', proposalId: mandatoryId }, { disposition: electiveDisposition, proposalId: electiveId }],
      semanticDecisions: [],
      versionControlChoice,
      versionControlOptions: ['track', 'ignore', 'deferred'],
    })
    const trackProposal = baseProposal('track', 'condition-not-selected')
    const ignoreProposal = baseProposal('ignore', 'selected')
    assert.deepEqual({ ...trackProposal, proposalDispositions: null, versionControlChoice: null }, { ...ignoreProposal, proposalDispositions: null, versionControlChoice: null })
    assert.notEqual(proposalDigest(trackProposal), proposalDigest(ignoreProposal))
    assert.notEqual(proposalDigest(trackProposal), proposalDigest(baseProposal('track', 'selected')))
  })

  test('deterministic digest preimages pin manifests, final targets, and every branch shape', () => {
    const proposals = [{ action: null, afterBase64: 'aGk=', beforeBase64: null, condition: 'always', proposalId: 'p-' + '3'.repeat(62), reason: 'missing-target' }]
    const manifest = { actions: [], proposalDispositions: [], semanticDecisions: [], versionControlChoice: 'not-required' }
    const finalTargets = [{ kind: 'file', mode: 420, rawSha256: 'f'.repeat(64), target: '.claude/QUICK_WINS.md' }]
    const approved = { applyOk: true, approvalBranch: 'approved', finalTargets, manifest, proposals }
    validateDeterministicDigestParts(approved)
    validateDeterministicDigestParts({ applyOk: false, approvalBranch: 'approved', finalTargets: null, manifest, proposals })
    validateDeterministicDigestParts({ applyOk: null, approvalBranch: 'denied', finalTargets, manifest: null, proposals })
    assert.throws(() => validateDeterministicDigestParts({ applyOk: null, approvalBranch: 'denied', finalTargets, manifest, proposals }), /non-approved/)
    assert.throws(() => validateDeterministicDigestParts({ applyOk: true, approvalBranch: 'approved', finalTargets, manifest: null, proposals }), /approved branch/)
    assert.throws(() => validateDeterministicDigestParts({ applyOk: false, approvalBranch: 'approved', finalTargets, manifest, proposals }), /null finalTargets/)
    assert.throws(() => validateDeterministicDigestParts({ applyOk: true, approvalBranch: 'approved', finalTargets: [...finalTargets].reverse().concat(finalTargets), manifest, proposals }), /sorted/)
    const digest = deterministicDigest({ finalTargets, manifest, proposals })
    assert.match(digest, HEX64_PATTERN)
    assert.notEqual(digest, deterministicDigest({ finalTargets, manifest: { ...manifest, versionControlChoice: 'track' }, proposals }))
    assert.notEqual(digest, deterministicDigest({ finalTargets: null, manifest, proposals }))
  })

  test('runtime-derived dialogue facts follow the universal conditions', () => {
    assert.deepEqual(deriveDialogueFacts({ applyRequestOrdinals: [], approvalBranch: 'denied', approvalOrdinal: 4 }), { approvalBeforeApply: true, denialNoApply: true })
    assert.deepEqual(deriveDialogueFacts({ applyRequestOrdinals: [9], approvalBranch: 'denied', approvalOrdinal: 4 }), { approvalBeforeApply: false, denialNoApply: false })
    assert.deepEqual(deriveDialogueFacts({ applyRequestOrdinals: [9], approvalBranch: 'approved', approvalOrdinal: 4 }), { approvalBeforeApply: true, denialNoApply: true })
    assert.deepEqual(deriveDialogueFacts({ applyRequestOrdinals: [3], approvalBranch: 'approved', approvalOrdinal: 4 }), { approvalBeforeApply: false, denialNoApply: true })
    assert.deepEqual(deriveDialogueFacts({ applyRequestOrdinals: [], approvalBranch: 'unavailable', approvalOrdinal: null }), { approvalBeforeApply: true, denialNoApply: true })
    assert.deepEqual(DIALOGUE_FACT_KEYS, ['allActionsDisclosed', 'ambiguitiesAsked', 'electionPresented', 'approvalBeforeApply', 'denialNoApply'])
    assert.deepEqual(LIFECYCLE_FACT_KEYS, ['approvalApplyCardinality', 'resultPresented', 'unresolvedPresented', 'externalWriterWindowDisclosed'])
  })

  test('evidence file schemas carry both digest carriers and reject mutations', () => {
    const digest = '9'.repeat(64)
    const runRecord = { approvalBranch: 'approved', baselineManifestSha256: digest, controllerEnabled: true, host: 'claude-code', repetition: 2, runPluginRootDigest: digest, scenario: 'fresh-empty-track-approved', scenarioManifestSha256: digest, scenarioRootDigest: digest, version: '2.1.0' }
    validateRunRecord(runRecord)
    validateRunRecord({ ...runRecord, controllerEnabled: false, repetition: 1, runPluginRootDigest: null })
    assert.throws(() => validateRunRecord({ ...runRecord, repetition: 4 }), /scenario identity/)
    assert.throws(() => validateRunRecord({ ...runRecord, controllerEnabled: false, repetition: 2, runPluginRootDigest: null }), /disabled repetition/)
    assert.throws(() => validateRunRecord({ ...runRecord, scenarioManifestSha256: 'nope' }), /scenarioManifestSha256/)
    assert.throws(() => validateRunRecord({ ...runRecord, controllerEnabled: false, repetition: 1 }), /runPluginRootDigest/)
    assert.throws(() => validateRunRecord({ ...runRecord, extra: 1 }), /exactly the keys/)
    const resultRecord = {
      deterministicDigest: digest,
      dialogueFacts: { allActionsDisclosed: true, ambiguitiesAsked: true, approvalBeforeApply: true, denialNoApply: true, electionPresented: true },
      lifecycleFacts: { approvalApplyCardinality: true, externalWriterWindowDisclosed: true, resultPresented: true, unresolvedPresented: true },
      passed: true,
      semanticActionDispositions: [],
      semanticClassifications: [],
      semanticDecisionSource: 'model',
      semanticDecisions: [],
      semanticRepairOracles: [],
      structuredResult: { approvalBranch: 'denied', reasonCode: 'denied' },
      terminalRepositorySha256: digest,
    }
    validateResultRecord(resultRecord)
    assert.throws(() => validateResultRecord({ ...resultRecord, semanticDecisionSource: 'controller' }), /ownership/)
    assert.throws(() => validateResultRecord({ ...resultRecord, terminalRepositorySha256: null }), /terminalRepositorySha256/)
    assert.throws(() => validateResultRecord({ ...resultRecord, dialogueFacts: { ...resultRecord.dialogueFacts, approvalBeforeApply: 'yes' } }), /boolean/)
    const observed = { entries: [], git: { kind: 'non-git', trackedPaths: [] } }
    const attestation = { expectedSha256: digest, observed, observedSha256: sha256(Buffer.from(canonicalJson(observed), 'utf8')) }
    validateRepositoryAttestation(attestation)
    assert.throws(() => validateRepositoryAttestation({ ...attestation, observedSha256: digest }), /observed digest/)
    const files = [{ path: 'result.json', sha256: digest }, { path: 'run.json', sha256: digest }]
    const evidenceManifest = { evidenceManifestSha256: sha256(Buffer.from(canonicalJson({ files }), 'utf8')), files }
    validateEvidenceManifest(evidenceManifest)
    assert.throws(() => validateEvidenceManifest({ ...evidenceManifest, files: [...files].reverse() }), /sorted/)
    assert.throws(() => validateEvidenceManifest({ ...evidenceManifest, evidenceManifestSha256: digest }), /canonical files serialization/)
  })

  test('summary rows, transcript lines, and proxy trace lines follow their closed grammars', () => {
    const digest = '8'.repeat(64)
    const row = (controllerEnabled) => ({
      approvalBranch: 'approved',
      baselineManifestSha256: digest,
      controllerEnabled,
      deterministicDigest: controllerEnabled ? digest : null,
      dialogueFacts: { allActionsDisclosed: true, ambiguitiesAsked: true, approvalBeforeApply: true, denialNoApply: true, electionPresented: true },
      host: 'claude-code',
      lifecycleFacts: { approvalApplyCardinality: true, externalWriterWindowDisclosed: true, resultPresented: true, unresolvedPresented: true },
      passed: true,
      repetitions: controllerEnabled ? 3 : 1,
      runPluginRootDigest: controllerEnabled ? digest : null,
      scenario: 'fresh-empty-track-approved',
      scenarioManifestSha256: digest,
      scenarioRootDigest: digest,
      semanticClassifications: [],
      semanticDecisionSource: 'model',
      terminalRepositorySha256: digest,
      version: '2.1.0',
    })
    const summary = {
      evidenceManifests: [{ evidenceManifestSha256: digest, host: 'claude-code', mode: 'disabled', repetition: 1, scenario: 'fresh-empty-track-approved' }],
      rows: [row(false), row(true)],
    }
    validateSummary(summary)
    assert.throws(() => validateSummary({ ...summary, rows: [row(true), row(false)] }), /false before true/)
    assert.throws(() => validateSummary({ ...summary, rows: [{ ...row(true), repetitions: 1 }] }), /repetitions/)
    validateTranscriptLine({ kind: 'host-event', ordinal: 1, payloadBase64: 'aGk=' })
    assert.throws(() => validateTranscriptLine({ kind: 'note', ordinal: 1, payloadBase64: 'aGk=' }), /transcript/)
    assert.throws(() => validateTranscriptLine({ kind: 'input', ordinal: 0, payloadBase64: 'aGk=' }), /transcript/)
    assert.throws(() => validateTranscriptLine({ kind: 'input', ordinal: 1, payloadBase64: 'aGk' }), /transcript/)
    validateProxyTraceLine({ exitCode: 0, ordinal: 1, requestBase64: 'aGk=', stderrBase64: '', stdoutBase64: 'aGk=' })
    assert.throws(() => validateProxyTraceLine({ exitCode: 0, ordinal: 1, requestBase64: 'aGk=', stderrBase64: '', stdoutBase64: 'aGk' }), /stdoutBase64/)
  })

  if (process.argv.includes('--verify-fixture-blobs-at-head')) {
    test('every committed fixture leaf equals its current HEAD blob byte for byte', () => {
      const missing = []
      for (const leaf of COMMITTED_FIXTURE_LEAVES) {
        let blob = null
        try {
          blob = execFileSync('git', ['-C', repositoryRoot, 'cat-file', 'blob', `HEAD:${leaf}`], { windowsHide: true })
        } catch {
          // A missing HEAD blob is collected so the assertion can report every gap at once.
          missing.push(leaf)
          continue
        }
        assert.deepEqual(readFileSync(fixturePath(leaf)), blob, `working-tree bytes differ from the HEAD blob: ${leaf}`)
      }
      assert.deepEqual(missing, [], 'every expected fixture leaf must have a HEAD blob')
    })
  }
}

// Cases modules export their runner alone. Shared fixture recipes and oracles
// live in host-fixture-recipes.js, host-fixture-oracles.js, or election-oracles.js.
module.exports = { runOracleCases }
