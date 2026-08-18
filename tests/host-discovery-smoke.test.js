'use strict'

const assert = require('node:assert/strict')
const { copyFileSync, cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

const {
  CODEX_CATALOG_PROMPT,
  createCellSequence,
  classifyChildExit,
  executeCellSequence,
  assertEngineClosure,
  assertClaudeInventory,
  PUBLIC_SKILLS,
  buildCodexArgv,
  createMarketplace,
  evaluateEvidence,
  loadLegacyBaseline,
  loadCandidateEngineResources,
  projectRuntimeEnvironment,
  parseClaudeAuthStatus,
  parseClaudeDetails,
  parseCodexAuthStatus,
  resolveExternalClaudeConfigRoot,
  stageCandidate,
  validateEvidenceRow,
} = require('./host-discovery-smoke-lib')
const { REVISE_ENGINE_RESOURCES } = require('./entry-contract')

const TEMP_PREFIX = 'nightshift-host-smoke-test-'

function createTemporaryDirectory() {
  return mkdtempSync(join(tmpdir(), TEMP_PREFIX))
}

function removeTemporaryDirectory(directoryPath) {
  rmSync(directoryPath, { force: true, recursive: true })
}

function createEngineFixture(root, directoryName = 'installed') {
  const installedRoot = join(root, directoryName)
  const engineRoot = join(installedRoot, 'internal', 'revise')
  mkdirSync(join(installedRoot, 'internal'), { recursive: true })
  cpSync(join(__dirname, '..', 'internal', 'revise'), engineRoot, { recursive: true })

  return engineRoot
}

function writeCandidateContract(candidateRoot, resources) {
  const testsRoot = join(candidateRoot, 'tests')
  mkdirSync(testsRoot, { recursive: true })
  writeFileSync(join(testsRoot, 'entry-contract.js'), "'use strict'\nmodule.exports = { REVISE_ENGINE_RESOURCES: " + JSON.stringify(resources) + ' }\n')
}

test('runtime projection copies only nonempty permitted values with original spelling', () => {
  const projection = projectRuntimeEnvironment({ PATH: 'p', Path: 'wrong', TEMP: 't', EMPTY: '', CODEX_ACCESS_TOKEN: 'secret', LANG: 'en_US' })

  assert.deepEqual(projection, { LANG: 'en_US', PATH: 'p', TEMP: 't' })
})

test('runtime projection preserves Windows parent spelling and POSIX exact spelling', () => {
  assert.deepEqual(projectRuntimeEnvironment({ Path: 'windows-path', TEMP: 'temp', path: 'ignored' }, 'win32'), { Path: 'windows-path', TEMP: 'temp' })
  assert.deepEqual(projectRuntimeEnvironment({ Path: 'ignored', PATH: 'posix-path', TEMP: 'temp' }, 'linux'), { PATH: 'posix-path', TEMP: 'temp' })
})

test('nonzero child classification exposes only structural JSON metadata or byte counts', () => {
  assert.equal(classifyChildExit(1, '{"type":"result","subtype":"error","is_error":true,"result":"secret"}', 72, 8), 'host child failed with exit code 1 json=true type=result subtype=error is_error=true')
  assert.equal(classifyChildExit(1, 'not json', 8, 3), 'host child failed with exit code 1 json=false stdoutBytes=8 stderrBytes=3')
  assert.equal(classifyChildExit(1, '{"type":"result","subtype":"error","is_error":"true"}', 59, 0), 'host child failed with exit code 1 json=true type=result subtype=error is_error=invalid')
})

test('host auth parsers accept only their pinned positive response shapes', () => {
  assert.equal(parseClaudeAuthStatus('{"loggedIn":true}'), true)
  assert.throws(() => parseClaudeAuthStatus('{"loggedIn":false}'), /authenticated/)
  assert.throws(() => parseClaudeAuthStatus('{"authenticated":true}'), /authenticated/)
  assert.throws(() => parseClaudeAuthStatus('{"loggedIn":"true"}'), /authenticated/)
  assert.equal(parseCodexAuthStatus('diagnostic line\nLogged in using ChatGPT\n', 'additional diagnostic\n'), true)
  assert.equal(parseCodexAuthStatus('', 'Logged in using an API key\n'), true)
  assert.throws(() => parseCodexAuthStatus('Not logged in\n', ''), /authenticated/)
  assert.throws(() => parseCodexAuthStatus('logged in\n', ''), /authenticated/)
  assert.throws(() => parseCodexAuthStatus('Logged in using ChatGPT\n', 'Logged in using an API key\n'), /authenticated/)
})

test('Claude details parser requires one counted unique Skills inventory line', () => {
  assert.deepEqual(parseClaudeDetails('Name: Nightshift\n  Skills (3)  exploring, ready, revise\n'), ['exploring', 'ready', 'revise'])
  assert.throws(() => parseClaudeDetails('  Skills (2)  exploring, ready, revise\n'), /count/)
  assert.throws(() => parseClaudeDetails('  Skills (2)  exploring, exploring\n'), /unique/)
  assert.throws(() => parseClaudeDetails('  Skills (2): exploring, ready\n'), /inventory/)
  assert.throws(() => parseClaudeDetails('Skills: exploring, ready\n'), /inventory/)
  assert.throws(() => parseClaudeDetails('  Skills (1)  ready\n  Skills (1)  revise\n'), /one/)
  assert.throws(() => assertClaudeInventory('  Skills (4)  exploring, ready, revise, extra\n', ['exploring', 'ready', 'revise']), /differs/)
})

test('Claude source selection accepts the default root and rejects relative configuration', () => {
  assert.equal(resolveExternalClaudeConfigRoot({}, '/home/test'), join('/home/test', '.claude'))
  assert.equal(resolveExternalClaudeConfigRoot({ CLAUDE_CONFIG_DIR: 'C:/profile' }, 'C:/Users/test'), 'C:/profile')
  assert.throws(() => resolveExternalClaudeConfigRoot({ CLAUDE_CONFIG_DIR: 'profile' }, 'C:/Users/test'), /absolute/)
})

test('installed engine closure accepts the shared resource contract', () => {
  const root = createTemporaryDirectory()
  try {
    const engineRoot = createEngineFixture(root)

    assert.equal(assertEngineClosure(join(root, 'installed'), REVISE_ENGINE_RESOURCES), engineRoot)
  } finally {
    removeTemporaryDirectory(root)
  }
})

test('installed engine closure follows the candidate snapshot resource contract', () => {
  const root = createTemporaryDirectory()
  try {
    const candidateRoot = join(root, 'candidate')
    const engineRoot = createEngineFixture(root, 'candidate')
    const candidateResources = { code: 'candidate-code.md', plan: 'candidate-plan.md', rigor: 'candidate-rigor.js', spec: 'candidate-spec.md', workflow: 'candidate-workflow.js' }
    for (const [resourceName, candidateName] of Object.entries(candidateResources)) {
      copyFileSync(join(engineRoot, REVISE_ENGINE_RESOURCES[resourceName]), join(engineRoot, candidateName))
    }
    const enginePath = join(engineRoot, 'SKILL.md')
    let engine = readFileSync(enginePath, 'utf8')
    for (const artifactType of ['code', 'plan', 'spec']) {
      engine = engine.replace('- `' + artifactType + '` -> `' + REVISE_ENGINE_RESOURCES[artifactType] + '`', '- `' + artifactType + '` -> `' + candidateResources[artifactType] + '`')
    }
    engine = engine.replace('${CLAUDE_PLUGIN_ROOT}/internal/revise/' + REVISE_ENGINE_RESOURCES.workflow, '${CLAUDE_PLUGIN_ROOT}/internal/revise/' + candidateResources.workflow)
    writeFileSync(enginePath, engine)
    writeCandidateContract(candidateRoot, candidateResources)

    const resources = loadCandidateEngineResources(candidateRoot)

    assert.deepEqual(resources, candidateResources)
    assert.doesNotThrow(() => assertEngineClosure(candidateRoot, resources))
  } finally {
    removeTemporaryDirectory(root)
  }
})

test('candidate resource contract loader rejects missing and malformed snapshots', () => {
  const root = createTemporaryDirectory()
  try {
    const candidateRoot = join(root, 'candidate')
    assert.throws(() => loadCandidateEngineResources(candidateRoot), /contract/)
    writeCandidateContract(candidateRoot, { ...REVISE_ENGINE_RESOURCES, rigor: '../rigor.js' })

    assert.throws(() => loadCandidateEngineResources(candidateRoot), /contract/)
  } finally {
    removeTemporaryDirectory(root)
  }
})

test('installed engine closure rejects a swapped profile mapping', () => {
  const root = createTemporaryDirectory()
  try {
    const engineRoot = createEngineFixture(root)
    const enginePath = join(engineRoot, 'SKILL.md')
    writeFileSync(enginePath, readFileSync(enginePath, 'utf8').replace('- `code` -> `code.md`', '- `code` -> `plan.md`'))

    assert.throws(() => assertEngineClosure(join(root, 'installed'), REVISE_ENGINE_RESOURCES), /mapping/)
  } finally {
    removeTemporaryDirectory(root)
  }
})

test('installed engine closure rejects a stale Workflow reference', () => {
  const root = createTemporaryDirectory()
  try {
    const engineRoot = createEngineFixture(root)
    const enginePath = join(engineRoot, 'SKILL.md')
    writeFileSync(enginePath, readFileSync(enginePath, 'utf8').replace('${CLAUDE_PLUGIN_ROOT}/internal/revise/revise-round.workflow.js', '${CLAUDE_PLUGIN_ROOT}/internal/revise/stale.workflow.js'))

    assert.throws(() => assertEngineClosure(join(root, 'installed'), REVISE_ENGINE_RESOURCES), /Workflow reference/)
  } finally {
    removeTemporaryDirectory(root)
  }
})

test('installed engine closure rejects a missing declared resource', () => {
  const root = createTemporaryDirectory()
  try {
    const engineRoot = createEngineFixture(root)
    rmSync(join(engineRoot, REVISE_ENGINE_RESOURCES.rigor))

    assert.throws(() => assertEngineClosure(join(root, 'installed'), REVISE_ENGINE_RESOURCES), /resource/)
  } finally {
    removeTemporaryDirectory(root)
  }
})

test('installed engine closure rejects a link-shaped declared resource', () => {
  const root = createTemporaryDirectory()
  try {
    const engineRoot = createEngineFixture(root)
    const resourcePath = join(engineRoot, REVISE_ENGINE_RESOURCES.rigor)
    rmSync(resourcePath)
    symlinkSync(REVISE_ENGINE_RESOURCES.code, resourcePath, 'file')

    assert.throws(() => assertEngineClosure(join(root, 'installed'), REVISE_ENGINE_RESOURCES), /resource/)
  } finally {
    removeTemporaryDirectory(root)
  }
})

test('installed engine closure rejects a declared resource outside the engine root', () => {
  const root = createTemporaryDirectory()
  try {
    createEngineFixture(root)
    writeFileSync(join(root, 'installed', 'internal', 'outside.md'), 'outside\n')
    const malformedResources = { ...REVISE_ENGINE_RESOURCES, rigor: '../outside.md' }

    assert.throws(() => assertEngineClosure(join(root, 'installed'), malformedResources), /resource/)
  } finally {
    removeTemporaryDirectory(root)
  }
})

test('legacy repeat baseline is bound to the immutable candidate snapshot', () => {
  const root = createTemporaryDirectory()
  try {
    const candidateRoot = join(root, 'candidate')
    const fixtureRoot = join(candidateRoot, 'tests', 'fixtures', 'legacy-plugin-2.4.5')
    mkdirSync(fixtureRoot, { recursive: true })
    mkdirSync(join(fixtureRoot, '.claude-plugin'))
    mkdirSync(join(fixtureRoot, 'commands'))
    mkdirSync(join(fixtureRoot, 'skills', 'ready'), { recursive: true })
    writeFileSync(join(fixtureRoot, '.claude-plugin', 'plugin.json'), '{"version":"2.4.5"}\n')
    writeFileSync(join(fixtureRoot, 'commands', 'handover.md'), 'legacy command\n')
    writeFileSync(join(fixtureRoot, 'skills', 'ready', 'SKILL.md'), 'legacy skill\n')

    const baseline = loadLegacyBaseline(candidateRoot)

    assert.equal(baseline.root, fixtureRoot)
    assert.equal(baseline.version, '2.4.5')
    assert.deepEqual(baseline.commandNames, ['handover'])
    assert.deepEqual(baseline.skillNames, ['ready'])
  } finally {
    removeTemporaryDirectory(root)
  }
})

test('createCellSequence emits discovery-only checkpoints', () => {
  assert.deepEqual(createCellSequence('claude', 'clean'), ['install-candidate', 'verify-candidate'])
  assert.deepEqual(createCellSequence('codex', 'clean'), ['install-candidate', 'verify-candidate'])
})

test('repeat sequences verify baseline and both candidate checkpoints without sentinels', () => {
  assert.deepEqual(createCellSequence('claude', 'repeat'), [
    'install-baseline', 'verify-baseline', 'replace-candidate', 'update-candidate', 'verify-candidate',
    'update-candidate', 'verify-candidate',
  ])
  assert.deepEqual(createCellSequence('codex', 'repeat'), [
    'install-baseline', 'verify-baseline', 'remove-baseline', 'replace-candidate', 'install-candidate', 'verify-candidate',
    'remove-candidate', 'install-candidate', 'verify-candidate',
  ])
})

test('sequence executor preserves repeat action order', async () => {
  const observed = []
  const sequence = createCellSequence('claude', 'repeat')
  const actions = Object.fromEntries([...new Set(sequence)].map((action) => [action, async () => observed.push(action)]))

  await executeCellSequence(sequence, actions)

  assert.deepEqual(observed, sequence)
})

test('candidate marketplace contains only the nightshift plugin from plugin', () => {
  const root = createTemporaryDirectory()
  try {
    const snapshot = join(root, 'snapshot')
    const marketplace = join(root, 'marketplace')
    mkdirSync(snapshot)
    writeFileSync(join(snapshot, 'marker.txt'), 'candidate')

    createMarketplace({ marketplaceRoot: marketplace, snapshotRoot: snapshot })

    const manifest = JSON.parse(require('node:fs').readFileSync(join(marketplace, '.claude-plugin', 'marketplace.json'), 'utf8'))
    assert.equal(manifest.name, 'astenlund')
    assert.deepEqual(manifest.plugins.map((plugin) => [plugin.name, plugin.source]), [['nightshift', './plugin']])
  } finally {
    removeTemporaryDirectory(root)
  }
})

test('staging the same indexed candidate is stable and excludes the ephemeral plan tree', () => {
  const root = createTemporaryDirectory()
  try {
    const checkoutRoot = join(__dirname, '..')
    const treeId = require('node:child_process').execFileSync('git', ['-C', checkoutRoot, 'write-tree'], { encoding: 'utf8' }).trim()
    const first = stageCandidate({ checkoutRoot, destinationRoot: join(root, 'first'), treeId })
    const second = stageCandidate({ checkoutRoot, destinationRoot: join(root, 'second'), treeId })

    assert.equal(first.digest, second.digest)
    assert.equal(require('node:fs').existsSync(join(first.root, '.claude', 'plans')), false)
  } finally {
    removeTemporaryDirectory(root)
  }
})

test('Codex catalog adapter builds its literal isolated-workspace-safe argv', () => {
  const snapshotRoot = '/snapshot'
  const catalogSchema = join(snapshotRoot, 'tests/fixtures/codex-skill-catalog.schema.json')
  assert.deepEqual(buildCodexArgv({ prompt: CODEX_CATALOG_PROMPT, schemaPath: catalogSchema }), ['exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--output-schema', catalogSchema, CODEX_CATALOG_PROMPT])
  assert.equal(CODEX_CATALOG_PROMPT, 'Return a JSON object whose skills array contains only the plugin-qualified Nightshift skill identifiers visible in the injected Skills catalog.')
})

test('evidence rows reject malformed values without smoke sentinels', () => {
  const row = { host: 'claude', mode: 'clean', status: 'pass', candidateVersion: '2.5.1', candidateDigest: 'a'.repeat(64), publicSkills: [...PUBLIC_SKILLS], legacyCommands: [], legacySkillPresent: false, diagnostic: null }

  assert.doesNotThrow(() => validateEvidenceRow(row))
  assert.throws(() => validateEvidenceRow({ ...row, unexpected: true }), /exactly/)
  assert.throws(() => validateEvidenceRow({ ...row, publicSkills: [...PUBLIC_SKILLS].reverse() }), /ordinal/)
  assert.throws(() => validateEvidenceRow({ ...row, diagnostic: '' }), /diagnostic/)
  assert.throws(() => validateEvidenceRow({ ...row, candidateVersion: null }), /candidate/)
  assert.throws(() => validateEvidenceRow({ ...row, candidateDigest: null }), /candidate/)
  assert.throws(() => validateEvidenceRow({ ...row, obsolete: true }), /exactly/)
})

test('local evidence accepts absent-host provisional rows', () => {
  const root = createTemporaryDirectory()
  try {
    const checkoutRoot = join(__dirname, '..')
    const treeId = require('node:child_process').execFileSync('git', ['-C', checkoutRoot, 'write-tree'], { encoding: 'utf8' }).trim()
    const candidate = stageCandidate({ checkoutRoot, destinationRoot: join(root, 'candidate'), treeId })
    const evidenceRoot = join(root, 'evidence')
    mkdirSync(evidenceRoot)
    for (const host of ['claude', 'codex']) {
      for (const mode of ['clean', 'repeat']) {
        const provisional = host === 'codex'
        const row = {
          host,
          mode,
          status: provisional ? 'provisional' : 'pass',
          candidateVersion: candidate.version,
          candidateDigest: candidate.digest,
          publicSkills: PUBLIC_SKILLS.map((name) => 'nightshift:' + name),
          legacyCommands: [],
          legacySkillPresent: false,
          diagnostic: provisional ? 'host executable absent' : null,
        }
        writeFileSync(join(evidenceRoot, host + '-' + mode + '.json'), JSON.stringify(row) + '\n')
      }
    }

    assert.doesNotThrow(() => evaluateEvidence({ checkoutRoot, evidenceRoot, release: false }))
    assert.throws(() => evaluateEvidence({ checkoutRoot, evidenceRoot, release: true }), /status/)
    const invalid = JSON.parse(require('node:fs').readFileSync(join(evidenceRoot, 'codex-clean.json'), 'utf8'))
    invalid.status = 'fail'
    writeFileSync(join(evidenceRoot, 'codex-clean.json'), JSON.stringify(invalid) + '\n')
    assert.throws(() => evaluateEvidence({ checkoutRoot, evidenceRoot, release: false }), /status/)
  } finally {
    removeTemporaryDirectory(root)
  }
})
