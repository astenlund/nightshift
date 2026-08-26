'use strict'

const assert = require('node:assert/strict')
const { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

const { SOURCE_COMMIT, SOURCE_PATHS } = require('./init-backlog-controller/baseline.cases')
const { runAssetCases } = require('./init-backlog-controller/assets.cases')
const { canonicalJson, fixtureRoot, git, loadPromptBaseline, sha256, sourceClosure } = require('./init-backlog-controller/helpers')
const { assembleClaudePromptBaseline, assembleCodexPromptBaseline, loadPromptBaseline: loadHostPromptBaseline, stageCandidate } = require('./host-discovery-smoke-lib')

const REPOSITORY_ROOT = join(__dirname, '..')

function compareOrdinal(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function isContained(root, target) {
  const relation = require('node:path').relative(root, target)
  return relation !== '' && relation !== '..' && !relation.startsWith('..' + require('node:path').sep) && !require('node:path').isAbsolute(relation)
}

function listFiles(root, prefix = '') {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    const target = join(root, entry.name)
    if (entry.isDirectory()) {
      return listFiles(target, entryPath)
    }
    assert.ok(entry.isFile() && !entry.isSymbolicLink(), `Installed fixture entry is invalid: ${entryPath}`)

    return [entryPath]
  }).sort(compareOrdinal)
}

test('the immutable prompt baseline copies the exact runtime closure from its source commit', () => {
  const baseline = loadPromptBaseline(REPOSITORY_ROOT, SOURCE_COMMIT)
  const { manifest } = baseline

  assert.deepEqual(Object.keys(manifest).sort(), ['files', 'schemaVersion', 'sourceCommit'])
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.sourceCommit, SOURCE_COMMIT)
  assert.equal(baseline.baselineManifestSha256, sha256(Buffer.from(canonicalJson(manifest) + '\n', 'utf8')))
  assert.ok(Array.isArray(manifest.files))
  for (const entry of manifest.files) {
    assert.deepEqual(Object.keys(entry).sort(), ['path', 'sha256'])
    assert.match(entry.path, /^(?:\.claude-plugin|internal|skills)\//)
    assert.match(entry.sha256, /^[a-f0-9]{64}$/)
  }

  const manifestPaths = manifest.files.map((entry) => entry.path)
  assert.deepEqual(manifestPaths, [...manifestPaths].sort(), 'manifest file paths must be ordinal sorted')
  assert.equal(new Set(manifestPaths).size, manifestPaths.length, 'manifest file paths must be unique')
  assert.deepEqual(manifestPaths, SOURCE_PATHS)
  assert.equal(manifestPaths.includes('skills/init-backlog/init-backlog.js'), false, 'the source baseline predates the controller')

  const closure = sourceClosure(REPOSITORY_ROOT, SOURCE_COMMIT)
  assert.deepEqual(closure, SOURCE_PATHS)
  const copiedRoot = fixtureRoot(REPOSITORY_ROOT)
  const hostFixture = loadHostPromptBaseline(REPOSITORY_ROOT)
  assert.ok(copiedRoot.startsWith(REPOSITORY_ROOT))
  assert.equal(hostFixture.root, copiedRoot)
  assert.equal(hostFixture.manifest.sourceCommit, SOURCE_COMMIT)
  assert.ok(git(REPOSITORY_ROOT, ['rev-parse', SOURCE_COMMIT]).toString('utf8').trim() === SOURCE_COMMIT)
})

test('both host prompt assemblers install only the staged copied baseline fixture', () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'nightshift-init-backlog-controller-'))
  try {
    const candidate = stageCandidate({ checkoutRoot: REPOSITORY_ROOT, destinationRoot: temporaryRoot, treeId: git(REPOSITORY_ROOT, ['write-tree']).toString('utf8').trim() })
    const baseline = loadHostPromptBaseline(candidate.root)
    const assemblies = [
      assembleClaudePromptBaseline({ candidateRoot: candidate.root, destinationRoot: join(temporaryRoot, 'claude') }),
      assembleCodexPromptBaseline({ candidateRoot: candidate.root, destinationRoot: join(temporaryRoot, 'codex') }),
    ]
    const expectedPaths = baseline.manifest.files.map((entry) => entry.path)

    for (const assembly of assemblies) {
      assert.ok(isContained(candidate.root, assembly.fixtureRoot), 'Host fixture root escapes the staged candidate')
      assert.deepEqual(listFiles(assembly.installedRoot), expectedPaths)
      for (const entry of baseline.manifest.files) {
        const fixturePath = join(assembly.fixtureRoot, ...entry.path.split('/'))
        const installedPath = join(assembly.installedRoot, ...entry.path.split('/'))

        assert.ok(existsSync(installedPath), `Installed fixture file is missing: ${entry.path}`)
        assert.equal(sha256(readFileSync(installedPath)), entry.sha256, `Installed fixture digest differs: ${entry.path}`)
        assert.deepEqual(readFileSync(installedPath), readFileSync(fixturePath), `Installed fixture bytes differ: ${entry.path}`)
      }
    }
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true })
  }
})

test('normalized scaffold assets preserve the prompt-owned template contract', () => {
  runAssetCases(REPOSITORY_ROOT)
})
