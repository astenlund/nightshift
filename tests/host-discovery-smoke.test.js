'use strict'

const assert = require('node:assert/strict')
const { chmodSync, copyFileSync, cpSync, existsSync, linkSync, lstatSync, mkdtempSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, symlinkSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { basename, delimiter, dirname, join } = require('node:path')
const test = require('node:test')

const {
  CODEX_CATALOG_PROMPT,
  createCellSequence,
  classifyChildExit,
  executeCellSequence,
  assertEngineClosure,
  assertClaudeInventory,
  assertInstalledBaseline,
  assertInstalledCandidate,
  assertOutsideCheckout,
  PUBLIC_SKILLS,
  buildCodexArgv,
  candidateFactsForIndex,
  createMarketplace,
  createTrustedSmokeRuntime,
  evaluateEvidence,
  loadLegacyBaseline,
  loadCandidateEngineResources,
  projectRuntimeEnvironment,
  parseClaudeAuthStatus,
  parseClaudeDetails,
  parseCodexAuthStatus,
  resolveExternalClaudeConfigRoot,
  stableEvidenceFile,
  stageCandidate,
  validateEvidenceRow,
  writeEvidence,
} = require('./host-discovery-smoke-lib')
const { REVISE_ENGINE_RESOURCES } = require('./entry-contract')

const TEMP_PREFIX = 'nightshift-host-smoke-test-'
const TEN_PUBLIC_SKILLS = Object.freeze([
  'exploring',
  'handover',
  'init-backlog',
  'ready',
  'revise-code',
  'revise-docs',
  'revise-lore',
  'revise-plan',
  'revise-spec',
  'spec-agreement',
])

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

function validEvidenceRow(overrides = {}) {
  return {
    candidateDigest: 'a'.repeat(64),
    candidateVersion: '2.6.14',
    diagnostic: null,
    host: 'claude',
    legacyCommands: [],
    legacySkillPresent: false,
    mode: 'clean',
    publicSkills: [...PUBLIC_SKILLS],
    status: 'pass',
    ...overrides,
  }
}

test('runtime projection copies only nonempty permitted values with original spelling', () => {
  const projection = projectRuntimeEnvironment({ PATH: 'p', Path: 'wrong', TEMP: 't', EMPTY: '', CODEX_ACCESS_TOKEN: 'secret', LANG: 'en_US' })

  assert.deepEqual(projection, { LANG: 'en_US', PATH: 'p', TEMP: 't' })
})

test('runtime projection preserves Windows parent spelling and POSIX exact spelling', () => {
  assert.deepEqual(projectRuntimeEnvironment({ Path: 'windows-path', TEMP: 'temp', path: 'ignored' }, 'win32'), { Path: 'windows-path', TEMP: 'temp' })
  assert.deepEqual(projectRuntimeEnvironment({ Path: 'ignored', PATH: 'posix-path', TEMP: 'temp' }, 'linux'), { PATH: 'posix-path', TEMP: 'temp' })
})

test('trusted smoke runtime excludes direct and linked protected PATH entries', () => {
  const root = createTemporaryDirectory()
  try {
    const checkoutRoot = join(root, 'checkout')
    const temporaryRoot = join(root, 'temporary')
    const evidenceRoot = join(checkoutRoot, 'evidence')
    const outsideRoot = join(root, 'outside')
    const linkedCheckout = join(root, 'linked-checkout')
    for (const directory of [checkoutRoot, temporaryRoot, evidenceRoot, outsideRoot]) {
      mkdirSync(directory, { recursive: true })
    }
    symlinkSync(checkoutRoot, linkedCheckout, process.platform === 'win32' ? 'junction' : 'dir')
    const suffix = process.platform === 'win32' ? '.exe' : ''
    for (const directory of [checkoutRoot, temporaryRoot, evidenceRoot, outsideRoot]) {
      for (const command of ['git', 'codex']) {
        const executable = join(directory, command + suffix)
        writeFileSync(executable, 'fake executable\n')
        if (process.platform !== 'win32') {
          chmodSync(executable, 0o755)
        }
      }
    }
    const path = [checkoutRoot, linkedCheckout, temporaryRoot, evidenceRoot, outsideRoot].join(delimiter)
    const runtime = createTrustedSmokeRuntime({
      checkoutRoot,
      evidenceRoot,
      host: 'codex',
      parentEnv: { OPENAI_API_KEY: 'fake-token', PATH: path },
      temporaryRoot,
    })

    assert.equal(runtime.gitExecutable, join(outsideRoot, 'git' + suffix))
    assert.equal(runtime.hostExecutable, join(outsideRoot, 'codex' + suffix))
    assert.equal(runtime.environment.PATH, outsideRoot)
    assert.equal('OPENAI_API_KEY' in runtime.environment, false)
  } finally {
    removeTemporaryDirectory(root)
  }
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

test('installed-host evidence validators require the ten-skill inventory in ordinal order', () => {
  assert.deepEqual(PUBLIC_SKILLS, TEN_PUBLIC_SKILLS)
  const claudeDetails = `  Skills (${TEN_PUBLIC_SKILLS.length})  ${TEN_PUBLIC_SKILLS.join(', ')}\n`
  const evidenceRow = {
    host: 'codex',
    mode: 'clean',
    status: 'pass',
    candidateVersion: '2.5.1',
    candidateDigest: 'a'.repeat(64),
    publicSkills: TEN_PUBLIC_SKILLS.map((name) => `nightshift:${name}`),
    legacyCommands: [],
    legacySkillPresent: false,
    diagnostic: null,
  }

  assert.deepEqual(assertClaudeInventory(claudeDetails, TEN_PUBLIC_SKILLS), TEN_PUBLIC_SKILLS)
  assert.doesNotThrow(() => validateEvidenceRow(evidenceRow))
  assert.throws(() => assertClaudeInventory(claudeDetails, TEN_PUBLIC_SKILLS.slice(0, -1)), /differs/)
})

test('Claude source selection accepts the default root and rejects relative configuration', () => {
  assert.equal(resolveExternalClaudeConfigRoot({}, '/home/test'), join('/home/test', '.claude'))
  assert.equal(resolveExternalClaudeConfigRoot({ CLAUDE_CONFIG_DIR: '/profile' }, '/home/test'), '/profile')
  assert.throws(() => resolveExternalClaudeConfigRoot({ CLAUDE_CONFIG_DIR: 'profile' }, '/home/test'), /absolute/)
})

test('outside-checkout assertion accepts the checkout parent, rejects a descendant, accepts a sibling', () => {
  const root = createTemporaryDirectory()
  try {
    const checkoutRoot = join(root, 'checkout')
    mkdirSync(checkoutRoot, { recursive: true })
    const parentSource = dirname(checkoutRoot)
    const descendantSource = join(checkoutRoot, 'inside.txt')
    writeFileSync(descendantSource, 'inside\n')
    const siblingSource = join(dirname(checkoutRoot), 'sibling.txt')
    writeFileSync(siblingSource, 'sibling\n')

    assert.doesNotThrow(() => assertOutsideCheckout(parentSource, checkoutRoot))
    assert.throws(() => assertOutsideCheckout(descendantSource, checkoutRoot), /outside the checkout/)
    assert.doesNotThrow(() => assertOutsideCheckout(siblingSource, checkoutRoot))
  } finally {
    removeTemporaryDirectory(root)
  }
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

test('installed inventories reject extras, omissions, links, and disallowed marker paths', () => {
  const root = createTemporaryDirectory()
  const snapshotRoot = join(root, 'snapshot')
  const installedRoot = join(root, 'profile', 'plugin')
  const outsideRoot = join(root, 'outside')
  const version = '2.6.14'
  try {
    mkdirSync(join(snapshotRoot, '.claude-plugin'), { recursive: true })
    mkdirSync(join(snapshotRoot, 'skills', 'ready'), { recursive: true })
    writeFileSync(join(snapshotRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ version }) + '\n')
    writeFileSync(join(snapshotRoot, 'skills', 'ready', 'SKILL.md'), 'ready\n')
    cpSync(snapshotRoot, installedRoot, { recursive: true })
    assert.doesNotThrow(() => assertInstalledCandidate(snapshotRoot, installedRoot, join(root, 'profile'), version, 'claude'))

    writeFileSync(join(installedRoot, 'extra.txt'), 'extra\n')
    assert.throws(() => assertInstalledCandidate(snapshotRoot, installedRoot, join(root, 'profile'), version, 'claude'), /unexpected installed entry/)
    rmSync(join(installedRoot, 'extra.txt'))

    const baselineRoot = join(root, 'baseline')
    const baselineInstalledRoot = join(root, 'baseline-profile', 'plugin')
    mkdirSync(join(baselineRoot, '.claude-plugin'), { recursive: true })
    mkdirSync(join(baselineRoot, 'commands'))
    mkdirSync(join(baselineRoot, 'skills', 'ready'), { recursive: true })
    writeFileSync(join(baselineRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ version: '2.4.5' }) + '\n')
    writeFileSync(join(baselineRoot, 'commands', 'handover.md'), 'handover\n')
    writeFileSync(join(baselineRoot, 'skills', 'ready', 'SKILL.md'), 'ready\n')
    cpSync(baselineRoot, baselineInstalledRoot, { recursive: true })
    const baseline = { root: baselineRoot, version: '2.4.5', commandNames: ['handover'], skillNames: ['ready'] }
    assert.doesNotThrow(() => assertInstalledBaseline(baseline, baselineInstalledRoot, join(root, 'baseline-profile'), 'claude'))
    mkdirSync(join(baselineInstalledRoot, 'skills', 'legacy'))
    writeFileSync(join(baselineInstalledRoot, 'skills', 'legacy', 'SKILL.md'), 'legacy\n')
    assert.throws(() => assertInstalledBaseline(baseline, baselineInstalledRoot, join(root, 'baseline-profile'), 'claude'), /unexpected installed entry/)

    rmSync(join(installedRoot, 'skills', 'ready', 'SKILL.md'))
    assert.throws(() => assertInstalledCandidate(snapshotRoot, installedRoot, join(root, 'profile'), version, 'claude'), /missing installed entry/)
    cpSync(join(snapshotRoot, 'skills', 'ready', 'SKILL.md'), join(installedRoot, 'skills', 'ready', 'SKILL.md'))

    mkdirSync(outsideRoot)
    writeFileSync(join(outsideRoot, 'linked.txt'), 'linked\n')
    rmSync(join(installedRoot, 'skills', 'ready', 'SKILL.md'))
    symlinkSync(join(outsideRoot, 'linked.txt'), join(installedRoot, 'skills', 'ready', 'SKILL.md'))
    assert.throws(() => assertInstalledCandidate(snapshotRoot, installedRoot, join(root, 'profile'), version, 'claude'), /link/)
    rmSync(join(installedRoot, 'skills', 'ready', 'SKILL.md'))
    cpSync(join(snapshotRoot, 'skills', 'ready', 'SKILL.md'), join(installedRoot, 'skills', 'ready', 'SKILL.md'))

    mkdirSync(join(installedRoot, '.in_use'))
    assert.doesNotThrow(() => assertInstalledCandidate(snapshotRoot, installedRoot, join(root, 'profile'), version, 'claude'))
    assert.throws(() => assertInstalledCandidate(snapshotRoot, installedRoot, join(root, 'profile'), version, 'codex'), /unexpected installed entry/)
    writeFileSync(join(installedRoot, '.in_use', 'nested.txt'), 'nested\n')
    assert.throws(() => assertInstalledCandidate(snapshotRoot, installedRoot, join(root, 'profile'), version, 'claude'), /unexpected installed entry/)
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

test('indexed candidate facts match one staged snapshot and exclude the ephemeral plan tree', () => {
  const root = createTemporaryDirectory()
  try {
    const checkoutRoot = join(__dirname, '..')
    const treeId = require('node:child_process').execFileSync('git', ['-C', checkoutRoot, 'write-tree'], { encoding: 'utf8' }).trim()
    const staged = stageCandidate({ checkoutRoot, destinationRoot: join(root, 'staged'), treeId })
    const indexed = candidateFactsForIndex(checkoutRoot)

    assert.deepEqual(indexed, { digest: staged.digest, version: staged.version })
    assert.equal(require('node:fs').existsSync(join(staged.root, '.claude', 'plans')), false)
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

test('evidence publication is exclusive and leaves one direct single-link row', () => {
  const checkoutRoot = createTemporaryDirectory()
  try {
    const evidenceRoot = join(checkoutRoot, '.tmp', 'evidence')
    const row = validEvidenceRow()
    writeEvidence({ checkoutRoot, evidenceRoot, row })
    const rowPath = join(evidenceRoot, 'claude-clean.json')
    const bytes = readFileSync(rowPath)
    const metadata = lstatSync(rowPath, { bigint: true })

    assert.equal(metadata.isFile() && !metadata.isSymbolicLink() && metadata.nlink === 1n, true)
    assert.deepEqual(bytes, Buffer.from(JSON.stringify(row) + '\n', 'utf8'))
    assert.throws(() => writeEvidence({ checkoutRoot, evidenceRoot, row }), /already exists/)
    assert.deepEqual(readFileSync(rowPath), bytes, 'a repeated cell cannot replace its prior evidence')
  } finally {
    removeTemporaryDirectory(checkoutRoot)
  }
})

test('evidence row bytes are bounded before publication staging and reading', () => {
  const evidenceRowByteLimit = 1048576
  const publicationRoot = createTemporaryDirectory()
  const readRoot = createTemporaryDirectory()
  try {
    const publicationEvidenceRoot = join(publicationRoot, '.tmp', 'evidence')
    const exactRow = validEvidenceRow({ diagnostic: 'x', status: 'fail' })
    const initialByteLength = Buffer.byteLength(JSON.stringify(exactRow) + '\n', 'utf8')
    exactRow.diagnostic += 'x'.repeat(evidenceRowByteLimit - initialByteLength)
    assert.equal(Buffer.byteLength(JSON.stringify(exactRow) + '\n', 'utf8'), evidenceRowByteLimit)
    writeEvidence({ checkoutRoot: publicationRoot, evidenceRoot: publicationEvidenceRoot, row: exactRow })
    assert.equal(lstatSync(join(publicationEvidenceRoot, 'claude-clean.json')).size, evidenceRowByteLimit)

    const oversizedRow = { ...exactRow, diagnostic: exactRow.diagnostic + 'x', host: 'codex', mode: 'repeat' }
    assert.throws(() => writeEvidence({ checkoutRoot: publicationRoot, evidenceRoot: publicationEvidenceRoot, row: oversizedRow }), /byte limit/)
    assert.deepEqual(readdirSync(publicationEvidenceRoot), ['claude-clean.json'])

    const readEvidenceRoot = join(readRoot, 'evidence')
    mkdirSync(readEvidenceRoot)
    for (const filename of ['claude-clean.json', 'claude-repeat.json', 'codex-clean.json', 'codex-repeat.json']) {
      writeFileSync(join(readEvidenceRoot, filename), filename === 'claude-clean.json' ? Buffer.alloc(evidenceRowByteLimit, 0x78) : '{}\n')
    }
    assert.throws(() => evaluateEvidence({ checkoutRoot: readRoot, evidenceRoot: readEvidenceRoot, release: false }), SyntaxError)
    writeFileSync(join(readEvidenceRoot, 'claude-clean.json'), Buffer.alloc(evidenceRowByteLimit + 1, 0x78))
    assert.throws(() => evaluateEvidence({ checkoutRoot: readRoot, evidenceRoot: readEvidenceRoot, release: false }), /byte limit/)
  } finally {
    removeTemporaryDirectory(publicationRoot)
    removeTemporaryDirectory(readRoot)
  }
})

test('stable evidence reads reject injected growth and path substitution', () => {
  const evidenceRowByteLimit = 1048576
  const root = createTemporaryDirectory()
  const rowPath = join(root, 'row.json')
  try {
    writeFileSync(rowPath, '{}\n')
    let largestRead = 0
    let grew = false
    assert.throws(() => stableEvidenceFile(root, rowPath, {
      readSync: (...args) => {
        largestRead = Math.max(largestRead, args[3])
        if (!grew) {
          grew = true
          writeFileSync(rowPath, Buffer.alloc(evidenceRowByteLimit + 1, 0x78))
        }

        return readSync(...args)
      },
    }), /byte limit|changed during verification/)
    assert.equal(largestRead, evidenceRowByteLimit + 1)

    writeFileSync(rowPath, '{}\n')
    let reads = 0
    let substituted = false
    assert.throws(() => stableEvidenceFile(root, rowPath, {
      openSync: (...args) => {
        if (!substituted) {
          substituted = true
          rmSync(rowPath)
          writeFileSync(rowPath, '{"replacement":true}\n')
        }

        return openSync(...args)
      },
      readSync: (...args) => {
        reads += 1

        return readSync(...args)
      },
    }), /changed during verification/)
    assert.equal(reads, 0)
  } finally {
    removeTemporaryDirectory(root)
  }
})

test('evidence publication rejects directory aliases and linked row destinations', () => {
  const checkoutRoot = createTemporaryDirectory()
  const outsideRoot = createTemporaryDirectory()
  try {
    const row = validEvidenceRow()
    symlinkSync(outsideRoot, join(checkoutRoot, '.tmp'), 'junction')
    assert.throws(() => writeEvidence({ checkoutRoot, evidenceRoot: join(checkoutRoot, '.tmp', 'evidence'), row }), /directory.*alias|ordinary direct directory/i)
    rmSync(join(checkoutRoot, '.tmp'), { force: true, recursive: true })

    mkdirSync(join(checkoutRoot, '.tmp'))
    symlinkSync(outsideRoot, join(checkoutRoot, '.tmp', 'evidence'), 'junction')
    assert.throws(() => writeEvidence({ checkoutRoot, evidenceRoot: join(checkoutRoot, '.tmp', 'evidence'), row }), /directory.*alias|ordinary direct directory/i)
    rmSync(join(checkoutRoot, '.tmp', 'evidence'), { force: true, recursive: true })
    mkdirSync(join(checkoutRoot, '.tmp', 'evidence'))
    const rowPath = join(checkoutRoot, '.tmp', 'evidence', 'claude-clean.json')
    const outsideFile = join(outsideRoot, 'outside.json')
    writeFileSync(outsideFile, 'outside\n')
    symlinkSync(outsideFile, rowPath, 'file')
    assert.throws(() => writeEvidence({ checkoutRoot, evidenceRoot: join(checkoutRoot, '.tmp', 'evidence'), row }), /already exists/)
    assert.equal(readFileSync(outsideFile, 'utf8'), 'outside\n')
    rmSync(rowPath, { force: true })

    linkSync(outsideFile, rowPath)
    assert.throws(() => writeEvidence({ checkoutRoot, evidenceRoot: join(checkoutRoot, '.tmp', 'evidence'), row }), /already exists/)
    assert.equal(readFileSync(outsideFile, 'utf8'), 'outside\n')
  } finally {
    removeTemporaryDirectory(checkoutRoot)
    removeTemporaryDirectory(outsideRoot)
  }
})

test('local evidence accepts absent-host provisional rows', () => {
  const root = createTemporaryDirectory()
  const checkoutRoot = join(__dirname, '..')
  const evidenceRoot = mkdtempSync(join(checkoutRoot, '.tmp', 'nightshift-evidence-test-'))
  try {
    const treeId = require('node:child_process').execFileSync('git', ['-C', checkoutRoot, 'write-tree'], { encoding: 'utf8' }).trim()
    const candidate = stageCandidate({ checkoutRoot, destinationRoot: join(root, 'candidate'), treeId })
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
    const versionMutatedRowPath = join(evidenceRoot, 'codex-repeat.json')
    const versionMutatedRow = JSON.parse(readFileSync(versionMutatedRowPath, 'utf8'))
    versionMutatedRow.candidateVersion = candidate.version + '.mutated'
    writeFileSync(versionMutatedRowPath, JSON.stringify(versionMutatedRow) + '\n')
    assert.throws(() => evaluateEvidence({ checkoutRoot, evidenceRoot, release: false }), /version mismatch/)
    const versionMutatedRowBytes = JSON.stringify({ ...versionMutatedRow, candidateVersion: candidate.version }) + '\n'
    writeFileSync(versionMutatedRowPath, versionMutatedRowBytes)
    const copiedRowPath = join(evidenceRoot, 'codex-repeat.json')
    const copiedRowOriginal = readFileSync(copiedRowPath)
    try {
      writeFileSync(copiedRowPath, readFileSync(join(evidenceRoot, 'claude-clean.json')))
      assert.throws(() => evaluateEvidence({ checkoutRoot, evidenceRoot, release: false }), /identity.*filename/i)
    } finally {
      writeFileSync(copiedRowPath, copiedRowOriginal)
    }
    const evidenceHardlink = join(dirname(evidenceRoot), '.' + basename(evidenceRoot) + '-row-hardlink.json')
    try {
      linkSync(join(evidenceRoot, 'claude-clean.json'), evidenceHardlink)
      assert.throws(() => evaluateEvidence({ checkoutRoot, evidenceRoot, release: false }), /direct single-link file/)
    } finally {
      rmSync(evidenceHardlink, { force: true })
    }
    assert.throws(() => evaluateEvidence({ checkoutRoot, evidenceRoot, release: true }), /status/)
    const invalid = JSON.parse(require('node:fs').readFileSync(join(evidenceRoot, 'codex-clean.json'), 'utf8'))
    invalid.publicSkills = invalid.publicSkills.slice(0, -1)
    writeFileSync(join(evidenceRoot, 'codex-clean.json'), JSON.stringify(invalid) + '\n')
    assert.throws(() => evaluateEvidence({ checkoutRoot, evidenceRoot, release: false }), /public skills/)
    invalid.publicSkills = PUBLIC_SKILLS.map((name) => 'nightshift:' + name)
    invalid.status = 'fail'
    writeFileSync(join(evidenceRoot, 'codex-clean.json'), JSON.stringify(invalid) + '\n')
    assert.throws(() => evaluateEvidence({ checkoutRoot, evidenceRoot, release: false }), /status/)
  } finally {
    removeTemporaryDirectory(evidenceRoot)
    removeTemporaryDirectory(root)
  }
})
