'use strict'

const nodeFilesystem = require('node:fs')
const nodePath = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')

const { sha256 } = require('./init-backlog-session-driver/primitives')
const { canonicalJson, parseJsonWithDepthLimit } = require('./init-backlog-session-driver/transcript')

const SOURCE_COMMIT = '2f3f8187b4b6f5c3bb9da72284e277018f726643'
const SOURCE_PATHS = Object.freeze([
  '.claude-plugin/marketplace.json',
  '.claude-plugin/plugin.json',
  'internal/revise/SKILL.md',
  'internal/revise/code.md',
  'internal/revise/orchestration.js',
  'internal/revise/orchestration.test.js',
  'internal/revise/plan.md',
  'internal/revise/revise-round.test.js',
  'internal/revise/revise-round.workflow.js',
  'internal/revise/rigor.js',
  'internal/revise/rigor.test.js',
  'internal/revise/spec.md',
  'skills/exploring/SKILL.md',
  'skills/handover/SKILL.md',
  'skills/init-backlog/SKILL.md',
  'skills/init-backlog/unwrap.js',
  'skills/init-backlog/unwrap.test.js',
  'skills/ready/SKILL.md',
  'skills/ready/ready.js',
  'skills/ready/ready.test.js',
  'skills/revise-code/SKILL.md',
  'skills/revise-docs/SKILL.md',
  'skills/revise-lore/SKILL.md',
  'skills/revise-plan/SKILL.md',
  'skills/revise-spec/SKILL.md',
  'skills/spec-agreement/SKILL.md',
  'skills/spec-agreement/fixtures/fingerprint-v1.json',
  'skills/spec-agreement/spec-agreement.js',
  'skills/spec-agreement/spec-agreement.test.js',
])
const MAX_FIXTURE_ENTRIES = 256
const MAX_FIXTURE_FILE_BYTES = 16777216
const MAX_FIXTURE_TOTAL_BYTES = 67108864
const MAX_MANIFEST_BYTES = 1048576
const MAX_SOURCE_BATCH_RESPONSE_BYTES = MAX_FIXTURE_TOTAL_BYTES + MAX_MANIFEST_BYTES
const SOURCE_GIT_TIMEOUT_MS = 30000

function isContained(root, target) {
  const relation = nodePath.relative(root, target)

  return relation !== '' && relation !== '..' && !relation.startsWith(`..${nodePath.sep}`) && !nodePath.isAbsolute(relation)
}

function hasExactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',')
}

function validateRelativePath(path) {
  return typeof path === 'string'
    && path !== ''
    && !nodePath.isAbsolute(path)
    && !path.includes('\\')
    && path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

function stableReadFile({ filesystem, path, physicalRoot, sizeLimit }) {
  const before = filesystem.lstatSync(path, { bigint: true })
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`Prompt baseline member is not an ordinary nonlinked file: ${path}`)
  }
  if (before.size > BigInt(sizeLimit)) {
    throw new Error(`Prompt baseline member exceeds its byte limit: ${path}`)
  }
  const physicalPath = filesystem.realpathSync.native(path)
  if (!isContained(physicalRoot, physicalPath)) {
    throw new Error(`Prompt baseline member escapes the fixture root: ${path}`)
  }
  const bytes = filesystem.readFileSync(path)
  const after = filesystem.lstatSync(path, { bigint: true })
  if (!after.isFile() || after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino || before.size !== BigInt(bytes.length) || after.size !== BigInt(bytes.length)) {
    throw new Error(`Prompt baseline member is unstable: ${path}`)
  }

  return bytes
}

function listFixtureFiles({ filesystem, root, physicalRoot }) {
  const files = []
  let entryCount = 0
  const walk = (directory, prefix) => {
    for (const entry of filesystem.readdirSync(directory, { withFileTypes: true })) {
      entryCount += 1
      if (entryCount > MAX_FIXTURE_ENTRIES) {
        throw new Error('Prompt baseline fixture tree exceeds its entry limit')
      }
      const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      const target = nodePath.join(directory, entry.name)
      const metadata = filesystem.lstatSync(target)
      if (metadata.isSymbolicLink()) {
        throw new Error(`Prompt baseline fixture contains a link: ${relativePath}`)
      }
      const physicalTarget = filesystem.realpathSync.native(target)
      if (!isContained(physicalRoot, physicalTarget)) {
        throw new Error(`Prompt baseline fixture entry escapes its root: ${relativePath}`)
      }
      if (metadata.isDirectory()) {
        walk(target, relativePath)
      } else if (metadata.isFile()) {
        files.push(relativePath)
      } else {
        throw new Error(`Prompt baseline fixture contains an unsupported entry: ${relativePath}`)
      }
    }
  }
  walk(root, '')

  return files.sort()
}

class SourceGitCommandError extends Error {
  constructor(detailCode) {
    super(`bounded prompt-baseline source Git ${detailCode} failed`)
    this.detailCode = detailCode
    this.name = 'SourceGitCommandError'
  }
}

function defaultSourceGitRunner(repositoryRoot, args, maxBuffer, input = null) {
  return execFileSync('git', ['-C', repositoryRoot, ...args], { encoding: 'buffer', input, maxBuffer, shell: false, timeout: SOURCE_GIT_TIMEOUT_MS, windowsHide: true })
}

function createSourceGitRunner({ environment, gitExecutablePath, spawnSync: run = spawnSync }) {
  if (typeof gitExecutablePath !== 'string' || !nodePath.isAbsolute(gitExecutablePath)) {
    throw new Error('the prompt-baseline source Git runner requires a retained absolute trusted executable path')
  }
  if (environment === null || typeof environment !== 'object' || Array.isArray(environment)) {
    throw new Error('the prompt-baseline source Git runner requires a closed environment')
  }

  return (repositoryRoot, args, maxBuffer, input = null) => {
    const completion = run(gitExecutablePath, ['-C', repositoryRoot, ...args], {
      encoding: null,
      env: environment,
      input,
      killSignal: 'SIGKILL',
      maxBuffer,
      shell: false,
      timeout: SOURCE_GIT_TIMEOUT_MS,
      windowsHide: true,
    })
    const stdout = completion?.stdout
    const stderr = completion?.stderr
    if (completion?.error?.code === 'ENOBUFS' || Buffer.isBuffer(stdout) && stdout.length > maxBuffer || Buffer.isBuffer(stderr) && stderr.length > MAX_MANIFEST_BYTES) {
      throw new SourceGitCommandError('output-capacity')
    }
    if (completion?.error?.code === 'ETIMEDOUT' || completion?.signal !== null && completion?.signal !== undefined) {
      throw new SourceGitCommandError('termination')
    }
    if (completion?.error || completion?.status !== 0 || !Buffer.isBuffer(stdout) || !Buffer.isBuffer(stderr) || stderr.length !== 0) {
      throw new SourceGitCommandError('child-process')
    }

    return stdout
  }
}

function parseSourceBlobBatch(bytes, paths) {
  const sourceFiles = new Map()
  let offset = 0
  let totalBytes = 0
  for (const path of paths) {
    const headerEnd = bytes.indexOf(0x0a, offset)
    if (headerEnd === -1) {
      throw new Error('Prompt baseline source batch is missing an object header')
    }
    const header = bytes.subarray(offset, headerEnd).toString('ascii')
    const matched = /^[a-f0-9]{40,64} blob ([0-9]+)$/.exec(header)
    if (matched === null) {
      throw new Error(`Prompt baseline source batch returned an invalid object header: ${path}`)
    }
    const size = Number(matched[1])
    if (!Number.isSafeInteger(size) || size > MAX_FIXTURE_FILE_BYTES) {
      throw new Error('Prompt baseline source blobs exceed their byte limit')
    }
    const contentStart = headerEnd + 1
    const contentEnd = contentStart + size
    if (contentEnd >= bytes.length || bytes[contentEnd] !== 0x0a) {
      throw new Error(`Prompt baseline source batch returned truncated object bytes: ${path}`)
    }
    totalBytes += size
    if (totalBytes > MAX_FIXTURE_TOTAL_BYTES) {
      throw new Error('Prompt baseline source blobs exceed their byte limit')
    }
    sourceFiles.set(path, Buffer.from(bytes.subarray(contentStart, contentEnd)))
    offset = contentEnd + 1
  }
  if (offset !== bytes.length) {
    throw new Error('Prompt baseline source batch returned trailing output')
  }

  return sourceFiles
}

function loadSourceAuthority(repositoryRoot, sourceGitRunner) {
  const closureBytes = sourceGitRunner(repositoryRoot, ['ls-tree', '-rz', '--name-only', SOURCE_COMMIT, '--', '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', 'skills/', 'internal/', 'hooks/'], MAX_MANIFEST_BYTES)
  const paths = closureBytes.toString('utf8').split('\0').filter(Boolean).sort()
  if (paths.join('\0') !== SOURCE_PATHS.join('\0')) {
    throw new Error('Prompt baseline source closure differs from the frozen path authority')
  }
  const batchInput = Buffer.from(paths.map((path) => `${SOURCE_COMMIT}:${path}\n`).join(''), 'utf8')
  const batchOutput = sourceGitRunner(repositoryRoot, ['cat-file', '--batch'], MAX_SOURCE_BATCH_RESPONSE_BYTES, batchInput)
  const sourceFiles = parseSourceBlobBatch(batchOutput, paths)
  const files = paths.map((path) => {
    const bytes = sourceFiles.get(path)

    return { path, sha256: sha256(bytes) }
  })
  const manifestBytes = Buffer.from(`${canonicalJson({ files, schemaVersion: 1, sourceCommit: SOURCE_COMMIT })}\n`, 'utf8')

  return { manifestBytes, sourceFiles }
}

function loadPromptBaseline(repositoryRoot, { filesystem = nodeFilesystem, sourceGitRunner = defaultSourceGitRunner, sourceRepositoryRoot = repositoryRoot } = {}) {
  const logicalRepositoryRoot = nodePath.resolve(repositoryRoot)
  const physicalRepositoryRoot = filesystem.realpathSync.native(logicalRepositoryRoot)
  const root = nodePath.join(logicalRepositoryRoot, 'tests', 'fixtures', 'init-backlog-prompt-baseline')
  const rootMetadata = filesystem.lstatSync(root, { bigint: true })
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error('Prompt baseline root is not an ordinary nonlinked directory')
  }
  const physicalRoot = filesystem.realpathSync.native(root)
  if (!isContained(physicalRepositoryRoot, physicalRoot)) {
    throw new Error('Prompt baseline root escapes the repository')
  }
  const manifestPath = nodePath.join(root, 'manifest.json')
  const manifestBytes = stableReadFile({ filesystem, path: manifestPath, physicalRoot, sizeLimit: MAX_MANIFEST_BYTES })
  const parsed = parseJsonWithDepthLimit(manifestBytes.toString('utf8'))
  if (!parsed.ok) {
    throw new Error('Prompt baseline manifest is not valid bounded JSON')
  }
  const manifest = parsed.value
  if (!hasExactKeys(manifest, ['schemaVersion', 'sourceCommit', 'files']) || manifest.schemaVersion !== 1 || manifest.sourceCommit !== SOURCE_COMMIT || !Array.isArray(manifest.files)) {
    throw new Error('Prompt baseline manifest is invalid')
  }
  if (!manifestBytes.equals(Buffer.from(canonicalJson(manifest) + '\n', 'utf8'))) {
    throw new Error('Prompt baseline manifest is not canonical')
  }
  const entries = manifest.files.map((entry) => {
    if (!hasExactKeys(entry, ['path', 'sha256']) || !validateRelativePath(entry.path) || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error('Prompt baseline manifest entry path or digest is invalid')
    }

    return entry
  })
  const paths = entries.map((entry) => entry.path)
  if (paths.join('\0') !== SOURCE_PATHS.join('\0')) {
    throw new Error('Prompt baseline manifest file set differs from the frozen source closure')
  }
  const sourceAuthority = loadSourceAuthority(nodePath.resolve(sourceRepositoryRoot), sourceGitRunner)
  if (!manifestBytes.equals(sourceAuthority.manifestBytes)) {
    throw new Error('Prompt baseline manifest differs from the source blobs')
  }
  const fixtureFiles = listFixtureFiles({ filesystem, physicalRoot, root })
  const expectedFixtureFiles = ['manifest.json', ...SOURCE_PATHS].sort()
  if (fixtureFiles.join('\0') !== expectedFixtureFiles.join('\0')) {
    throw new Error('Prompt baseline fixture file set differs from the frozen source closure')
  }
  let totalBytes = 0
  const files = entries.map((entry) => {
    const path = nodePath.resolve(root, ...entry.path.split('/'))
    if (!isContained(root, path)) {
      throw new Error(`Prompt baseline manifest path is not contained: ${entry.path}`)
    }
    const bytes = stableReadFile({ filesystem, path, physicalRoot, sizeLimit: MAX_FIXTURE_FILE_BYTES })
    totalBytes += bytes.length
    if (totalBytes > MAX_FIXTURE_TOTAL_BYTES) {
      throw new Error('Prompt baseline fixture files exceed their aggregate byte limit')
    }
    if (sha256(bytes) !== entry.sha256) {
      throw new Error(`Prompt baseline bytes differ from the manifest digest: ${entry.path}`)
    }
    if (!bytes.equals(sourceAuthority.sourceFiles.get(entry.path))) {
      throw new Error(`Prompt baseline bytes differ from the source blob: ${entry.path}`)
    }

    return Object.freeze({ bytes, path: entry.path, sha256: entry.sha256 })
  })
  const rootAfter = filesystem.lstatSync(root, { bigint: true })
  if (!rootAfter.isDirectory() || rootAfter.isSymbolicLink() || rootMetadata.dev !== rootAfter.dev || rootMetadata.ino !== rootAfter.ino || filesystem.realpathSync.native(root) !== physicalRoot) {
    throw new Error('Prompt baseline root is unstable')
  }
  for (const entry of manifest.files) {
    Object.freeze(entry)
  }
  Object.freeze(manifest.files)

  return Object.freeze({ baselineManifestSha256: sha256(manifestBytes), files: Object.freeze(files), manifest: Object.freeze(manifest), root })
}

module.exports = { SOURCE_COMMIT, SOURCE_PATHS, SourceGitCommandError, createSourceGitRunner, loadPromptBaseline }
